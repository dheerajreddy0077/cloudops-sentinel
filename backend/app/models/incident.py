from pydantic import BaseModel, Field
from typing import Literal


class Incident(BaseModel):
    resource: str = Field(min_length=1)
    type: str = Field(min_length=1)
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    status: Literal["OPEN", "RESOLVED"]
    description: str = Field(min_length=1)
    region: str = Field(min_length=1)
