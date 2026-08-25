import uuid

from datetime import datetime, timedelta, timezone

import boto3


REGION = "ap-south-1"

INCIDENTS_TABLE_NAME = "cloudops-sentinel-incidents"


def get_aws_account_identity():
    sts = boto3.client(
        "sts",
        region_name=REGION
    )

    response = sts.get_caller_identity()

    return response


def get_cloudwatch_client():
    return boto3.client(
        "cloudwatch",
        region_name=REGION
    )


def get_ec2_client():
    return boto3.client(
        "ec2",
        region_name=REGION
    )


def get_incidents_table():
    dynamodb = boto3.resource(
        "dynamodb",
        region_name=REGION
    )

    return dynamodb.Table(
        INCIDENTS_TABLE_NAME
    )


def get_ec2_cpu_metrics(instance_id, start_time, end_time):
    cloudwatch = get_cloudwatch_client()

    response = cloudwatch.get_metric_statistics(
        Namespace="AWS/EC2",
        MetricName="CPUUtilization",
        Dimensions=[
            {
                "Name": "InstanceId",
                "Value": instance_id
            }
        ],
        StartTime=start_time,
        EndTime=end_time,
        Period=300,
        Statistics=[
            "Average"
        ],
        Unit="Percent"
    )

    datapoints = response.get(
        "Datapoints",
        []
    )

    datapoints.sort(
        key=lambda x: x["Timestamp"]
    )

    return datapoints


def check_high_cpu(instance_id, threshold=80):
    end_time = datetime.now(timezone.utc)

    start_time = (
        end_time -
        timedelta(minutes=15)
    )

    datapoints = get_ec2_cpu_metrics(
        instance_id,
        start_time,
        end_time
    )

    if not datapoints:
        return {
            "status": "NO_DATA",
            "cpu": None,
            "threshold": threshold
        }

    latest = datapoints[-1]

    cpu = latest.get(
        "Average",
        0
    )

    if cpu >= threshold:
        return {
            "status": "HIGH_CPU",
            "cpu": cpu,
            "threshold": threshold
        }

    return {
        "status": "NORMAL",
        "cpu": cpu,
        "threshold": threshold
    }


def create_cpu_incident(instance_id, cpu):
    table = get_incidents_table()

    response = table.scan(
        FilterExpression=(
            "#resource = :resource "
            "AND #type = :type "
            "AND #status = :status"
        ),
        ExpressionAttributeNames={
            "#resource": "resource",
            "#type": "type",
            "#status": "status"
        },
        ExpressionAttributeValues={
            ":resource": instance_id,
            ":type": "HIGH_CPU",
            ":status": "OPEN"
        }
    )

    existing_incidents = response.get(
        "Items",
        []
    )

    if existing_incidents:
        existing_incident = existing_incidents[0]

        existing_incident["already_open"] = True

        return existing_incident

    now = datetime.now(
        timezone.utc
    ).isoformat()

    incident = {
        "incident_id": str(
            uuid.uuid4()
        ),
        "resource": instance_id,
        "type": "HIGH_CPU",
        "severity": "HIGH",
        "status": "OPEN",
        "description": (
            f"EC2 CPU utilization is high. "
            f"Current CPU: {cpu:.2f}%"
        ),
        "region": REGION,
        "created_at": now,
        "updated_at": now
    }

    table.put_item(
        Item=incident
    )

    return incident


def monitor_ec2_cpu(instance_id, threshold=80):

    result = check_high_cpu(
        instance_id,
        threshold
    )

    if result["status"] == "HIGH_CPU":

        incident = create_cpu_incident(
            instance_id,
            result["cpu"]
        )

        if incident.get("already_open"):

            incident.pop(
                "already_open",
                None
            )

            return {
                "status": "INCIDENT_ALREADY_OPEN",
                "cpu": result["cpu"],
                "threshold": threshold,
                "incident": incident
            }

        return {
            "status": "INCIDENT_CREATED",
            "cpu": result["cpu"],
            "threshold": threshold,
            "incident": incident
        }

    return result


def get_incidents():
    table = get_incidents_table()

    response = table.scan()

    return response.get(
        "Items",
        []
    )


def reboot_ec2_instance(instance_id):
    ec2 = get_ec2_client()

    ec2.reboot_instances(
        InstanceIds=[
            instance_id
        ]
    )

    return {
        "status": "REBOOT_REQUESTED",
        "instance_id": instance_id,
        "message": (
            "EC2 instance reboot requested successfully"
        )
    }
def monitor_and_remediate_ec2(
    instance_id,
    threshold=80
):

    result = monitor_ec2_cpu(
        instance_id,
        threshold
    )

    if result["status"] == "NORMAL":

        return {
            "status": "NORMAL",
            "cpu": result["cpu"],
            "threshold": threshold,
            "remediation": None
        }

    if result["status"] == "NO_DATA":

        return {
            "status": "NO_DATA",
            "cpu": None,
            "threshold": threshold,
            "remediation": None
        }

    if result["status"] == "INCIDENT_ALREADY_OPEN":

        return {
            "status": "INCIDENT_ALREADY_OPEN",
            "cpu": result["cpu"],
            "threshold": threshold,
            "incident": result["incident"],
            "remediation": {
                "status": "SKIPPED",
                "reason": "An OPEN incident already exists"
            }
        }

    if result["status"] == "INCIDENT_CREATED":

        incident = result["incident"]

        remediation_result = reboot_and_verify_ec2(
            instance_id
        )

        saved_incident = save_remediation_result(
            incident["incident_id"],
            remediation_result
        )

        verification = remediation_result.get(
            "verification",
            "UNKNOWN"
        )

        resolution = resolve_incident_after_remediation(
            incident["incident_id"],
            verification
        )

        return {
            "status": "REMEDIATION_COMPLETED",
            "cpu": result["cpu"],
            "threshold": threshold,
            "incident": resolution,
            "remediation": remediation_result,
            "resolution": resolution
        }

    return {
        "status": "ERROR",
        "cpu": result.get("cpu"),
        "threshold": threshold,
        "remediation": None
    }
def get_ec2_instance_status(instance_id):

    ec2 = get_ec2_client()

    response = ec2.describe_instance_status(
        InstanceIds=[instance_id],
        IncludeAllInstances=True
    )

    statuses = response.get(
        "InstanceStatuses",
        []
    )

    if not statuses:
        return {
            "instance_id": instance_id,
            "state": "UNKNOWN",
            "system_status": "UNKNOWN",
            "instance_status": "UNKNOWN"
        }

    status = statuses[0]

    return {
        "instance_id": instance_id,
        "state": status["InstanceState"]["Name"],
        "system_status": status["SystemStatus"]["Status"],
        "instance_status": status["InstanceStatus"]["Status"]
    }
def reboot_and_verify_ec2(instance_id):

    reboot_result = reboot_ec2_instance(
        instance_id
    )

    import time

    for _ in range(6):

        time.sleep(10)

        health = get_ec2_instance_status(
            instance_id
        )

        if (
            health["state"] == "running"
            and
            health["system_status"] == "ok"
            and
            health["instance_status"] == "ok"
        ):
            return {
                "reboot": reboot_result,
                "health": health,
                "verification": "HEALTHY"
            }

    return {
        "reboot": reboot_result,
        "health": health,
        "verification": "HEALTH_CHECK_PENDING"
    }
def save_remediation_result(
    incident_id,
    remediation_result
):

    table = get_incidents_table()

    now = datetime.now(
        timezone.utc
    ).isoformat()

    health = remediation_result.get(
        "health",
        {}
    )

    verification = remediation_result.get(
        "verification",
        "UNKNOWN"
    )

    reboot = remediation_result.get(
        "reboot",
        {}
    )

    response = table.update_item(
        Key={
            "incident_id": incident_id
        },
        UpdateExpression="""
            SET remediation_status = :status,
                remediation_message = :message,
                remediation_verification = :verification,
                remediation_instance_state = :state,
                remediation_system_status = :system_status,
                remediation_instance_status = :instance_status,
                remediation_updated_at = :updated_at
        """,
        ExpressionAttributeValues={
            ":status": reboot.get(
                "status",
                "UNKNOWN"
            ),
            ":message": reboot.get(
                "message",
                ""
            ),
            ":verification": verification,
            ":state": health.get(
                "state",
                "UNKNOWN"
            ),
            ":system_status": health.get(
                "system_status",
                "UNKNOWN"
            ),
            ":instance_status": health.get(
                "instance_status",
                "UNKNOWN"
            ),
            ":updated_at": now
        },
        ReturnValues="ALL_NEW"
    )

    return response.get(
        "Attributes",
        {}
    )
def resolve_incident_after_remediation(
    incident_id,
    verification
):

    if verification != "HEALTHY":
        return {
            "status": "NOT_RESOLVED",
            "reason": "Remediation was not verified as healthy"
        }

    table = get_incidents_table()

    now = datetime.now(
        timezone.utc
    ).isoformat()

    response = table.update_item(
        Key={
            "incident_id": incident_id
        },
        UpdateExpression="""
            SET #status = :status,
                updated_at = :updated_at,
                resolution_reason = :reason
        """,
        ExpressionAttributeNames={
            "#status": "status"
        },
        ExpressionAttributeValues={
            ":status": "RESOLVED",
            ":updated_at": now,
            ":reason": "Incident resolved after successful EC2 remediation"
        },
        ReturnValues="ALL_NEW"
    )

    return response.get(
        "Attributes",
        {}
    )
