from fastapi import APIRouter

from backend.app.services.aws_service import get_aws_account_identity


router = APIRouter()


@router.get("/health")
def health_check():
    try:
        identity = get_aws_account_identity()

        return {
            "status": "healthy",
            "service": "CloudOps Sentinel API",
            "aws": "connected",
            "account": identity.get("Account")
        }

    except Exception as e:
        return {
            "status": "unhealthy",
            "service": "CloudOps Sentinel API",
            "aws": "disconnected",
            "error": str(e)
        }


@router.get("/aws/identity")
def aws_identity():
    identity = get_aws_account_identity()

    return {
        "account": identity.get("Account"),
        "arn": identity.get("Arn")
    }
