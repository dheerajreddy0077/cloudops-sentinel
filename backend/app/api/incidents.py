import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.app.models.incident import Incident
from backend.app.services.aws_service import (
    get_incidents_table,
    get_ec2_cpu_metrics,
    get_ec2_instance_status,
    reboot_ec2_instance,
    monitor_and_remediate_ec2,
)

router = APIRouter()


# ============================================================
# HELPER
# ============================================================

def utc_now():
    return datetime.now(timezone.utc).isoformat()


# ============================================================
# GET ALL INCIDENTS
# ============================================================

@router.get("/incidents")
def get_incidents():

    table = get_incidents_table()

    response = table.scan()

    incidents = response.get("Items", [])

    # Newest incidents first
    incidents.sort(
        key=lambda item: item.get("created_at", ""),
        reverse=True,
    )

    return {
        "count": len(incidents),
        "incidents": incidents,
        "next_key": response.get("LastEvaluatedKey"),
    }


# ============================================================
# GET SINGLE INCIDENT
# ============================================================

@router.get("/incidents/{incident_id}")
def get_incident(incident_id: str):

    table = get_incidents_table()

    response = table.get_item(
        Key={
            "incident_id": incident_id
        }
    )

    if "Item" not in response:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    return {
        "incident": response["Item"]
    }


# ============================================================
# CREATE INCIDENT
# ============================================================

@router.post("/incidents")
def create_incident(incident: Incident):

    table = get_incidents_table()

    incident_data = incident.model_dump()

    now = utc_now()

    incident_data["incident_id"] = str(uuid.uuid4())
    incident_data["created_at"] = now
    incident_data["updated_at"] = now

    # Defaults
    incident_data.setdefault("status", "OPEN")
    incident_data.setdefault("remediation_status", "NOT_STARTED")

    table.put_item(
        Item=incident_data
    )

    return {
        "message": "Incident created",
        "incident": incident_data,
    }


# ============================================================
# UPDATE INCIDENT STATUS
# ============================================================

@router.patch("/incidents/{incident_id}")
def update_incident_status(
    incident_id: str,
    status: str,
):

    table = get_incidents_table()

    response = table.get_item(
        Key={
            "incident_id": incident_id
        }
    )

    if "Item" not in response:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    incident = response["Item"]

    status = status.upper()

    allowed_statuses = {
        "OPEN",
        "IN_PROGRESS",
        "RESOLVED",
        "CLOSED",
    }

    if status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid status. Use OPEN, "
                "IN_PROGRESS, RESOLVED or CLOSED."
            ),
        )

    incident["status"] = status
    incident["updated_at"] = utc_now()

    if status == "RESOLVED":
        incident["remediation_status"] = "RESOLVED"

    table.put_item(
        Item=incident
    )

    return {
        "message": "Incident updated",
        "incident": incident,
    }


# ============================================================
# RESOLVE INCIDENT
# ============================================================

@router.post("/incidents/{incident_id}/resolve")
def resolve_incident(
    incident_id: str,
):

    table = get_incidents_table()

    response = table.get_item(
        Key={
            "incident_id": incident_id
        }
    )

    if "Item" not in response:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    incident = response["Item"]

    now = utc_now()

    incident["status"] = "RESOLVED"
    incident["remediation_status"] = "RESOLVED"
    incident["remediation_verification"] = "MANUAL_RESOLUTION"
    incident["resolution_reason"] = (
        "Incident manually resolved from dashboard"
    )
    incident["remediation_message"] = (
        "Incident resolved by operator"
    )
    incident["remediation_updated_at"] = now
    incident["updated_at"] = now

    table.put_item(
        Item=incident
    )

    return {
        "message": "Incident resolved",
        "incident": incident,
    }


# ============================================================
# REMEDIATE INCIDENT
# ============================================================

@router.post("/incidents/{incident_id}/remediate")
def remediate_incident(
    incident_id: str,
):

    table = get_incidents_table()

    response = table.get_item(
        Key={
            "incident_id": incident_id
        }
    )

    if "Item" not in response:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    incident = response["Item"]

    resource = incident.get("resource")

    if not resource:
        raise HTTPException(
            status_code=400,
            detail="Incident does not contain an EC2 resource",
        )

    now = utc_now()

    # Mark remediation as running
    incident["status"] = "IN_PROGRESS"
    incident["remediation_status"] = "IN_PROGRESS"
    incident["remediation_message"] = (
        "Automated remediation started"
    )
    incident["remediation_updated_at"] = now
    incident["updated_at"] = now

    table.put_item(
        Item=incident
    )

    try:

        result = monitor_and_remediate_ec2(
            resource
        )

        verification = get_ec2_instance_status(
            resource
        )

        instance_state = verification.get(
            "state"
        )

        system_status = verification.get(
            "system_status"
        )

        instance_status = verification.get(
            "instance_status"
        )

        incident["remediation_instance_state"] = (
            instance_state or "unknown"
        )

        incident["remediation_system_status"] = (
            system_status or "unknown"
        )

        incident["remediation_instance_status"] = (
            instance_status or "unknown"
        )

        incident["remediation_verification"] = (
            "VERIFIED"
            if (
                instance_state == "running"
                and system_status == "ok"
                and instance_status == "ok"
            )
            else "ATTENTION"
        )

        incident["remediation_message"] = str(
            result
        )

        if incident["remediation_verification"] == "VERIFIED":

            incident["status"] = "RESOLVED"
            incident["remediation_status"] = "RESOLVED"
            incident["resolution_reason"] = (
                "Automated remediation completed "
                "and EC2 health verified"
            )

        else:

            incident["status"] = "OPEN"
            incident["remediation_status"] = "FAILED"
            incident["resolution_reason"] = (
                "Remediation completed but EC2 "
                "health verification requires attention"
            )

        incident["remediation_updated_at"] = utc_now()
        incident["updated_at"] = utc_now()

        table.put_item(
            Item=incident
        )

        return {
            "message": "Remediation completed",
            "incident": incident,
            "remediation": result,
            "verification": verification,
        }

    except Exception as exc:

        incident["status"] = "OPEN"
        incident["remediation_status"] = "FAILED"
        incident["remediation_message"] = str(exc)
        incident["resolution_reason"] = (
            "Automated remediation failed"
        )
        incident["remediation_updated_at"] = utc_now()
        incident["updated_at"] = utc_now()

        table.put_item(
            Item=incident
        )

        raise HTTPException(
            status_code=500,
            detail={
                "message": "Remediation failed",
                "error": str(exc),
                "incident": incident,
            },
        )


# ============================================================
# CLOUDWATCH CPU
# ============================================================

@router.get("/cloudwatch/ec2/{instance_id}/cpu")
def get_ec2_cpu(instance_id: str):

    end_time = datetime.now(timezone.utc)

    start_time = (
        end_time
        - __import__("datetime").timedelta(minutes=15)
    )

    datapoints = get_ec2_cpu_metrics(
        instance_id,
        start_time,
        end_time,
    )

    return {
        "instance_id": instance_id,
        "metric": "CPUUtilization",
        "datapoints": datapoints,
    }


# ============================================================
# EC2 HEALTH
# ============================================================

@router.get("/ec2/{instance_id}/status")
def get_ec2_status(instance_id: str):

    return get_ec2_instance_status(
        instance_id
    )


# ============================================================
# EC2 REBOOT
# ============================================================

@router.post("/ec2/{instance_id}/reboot")
def reboot_ec2(instance_id: str):

    return reboot_ec2_instance(
        instance_id
    )


# ============================================================
# EC2 MONITOR
# ============================================================

@router.get("/monitor/ec2/{instance_id}")
def monitor_ec2(
    instance_id: str,
    threshold: float = 80,
):

    return monitor_and_remediate_ec2(
        instance_id,
        threshold=threshold,
    )


# ============================================================
# EC2 MONITOR + REMEDIATE
# ============================================================

@router.post(
    "/ec2/{instance_id}/monitor-and-remediate"
)
def monitor_and_remediate(
    instance_id: str,
):

    return monitor_and_remediate_ec2(
        instance_id
    )


# ============================================================
# DASHBOARD SUMMARY
# ============================================================

@router.get("/dashboard/summary")
def get_dashboard_summary():

    table = get_incidents_table()

    response = table.scan()

    incidents = response.get(
        "Items",
        [],
    )

    total = len(incidents)

    open_count = sum(
        1
        for incident in incidents
        if incident.get("status") == "OPEN"
    )

    in_progress_count = sum(
        1
        for incident in incidents
        if incident.get("status") == "IN_PROGRESS"
    )

    resolved_count = sum(
        1
        for incident in incidents
        if incident.get("status") == "RESOLVED"
    )

    closed_count = sum(
        1
        for incident in incidents
        if incident.get("status") == "CLOSED"
    )

    high_severity = sum(
        1
        for incident in incidents
        if str(
            incident.get("severity", "")
        ).upper() == "HIGH"
    )

    remediated = sum(
        1
        for incident in incidents
        if str(
            incident.get(
                "remediation_status",
                ""
            )
        ).upper()
        in {
            "RESOLVED",
            "SUCCESS",
            "VERIFIED",
        }
    )

    failed_remediation = sum(
        1
        for incident in incidents
        if str(
            incident.get(
                "remediation_status",
                ""
            )
        ).upper()
        == "FAILED"
    )

    return {
        "total_incidents": total,
        "open_incidents": open_count,
        "in_progress_incidents": in_progress_count,
        "resolved_incidents": resolved_count,
        "closed_incidents": closed_count,
        "high_severity_incidents": high_severity,
        "remediated_incidents": remediated,
        "failed_remediation_incidents": failed_remediation,
    }