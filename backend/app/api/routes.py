from fastapi import APIRouter

from backend.app.services.aws_service import (
    get_aws_account_identity,
    monitor_ec2_cpu
)


router = APIRouter()


@router.get("/health")
def health_check():

    return {
        "status": "healthy",
        "service": "CloudOps Sentinel API"
    }


@router.get("/aws/identity")
def aws_identity():

    identity = get_aws_account_identity()

    return {
        "account": identity.get("Account"),
        "arn": identity.get("Arn")
    }


@router.get("/monitor/ec2/{instance_id}")
def monitor_ec2(instance_id: str):

    result = monitor_ec2_cpu(
        instance_id
    )

    return result

