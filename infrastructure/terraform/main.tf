resource "aws_dynamodb_table" "incidents" {
  name         = "cloudops-sentinel-incidents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "incident_id"

  attribute {
    name = "incident_id"
    type = "S"
  }

  tags = {
    Project     = "CloudOps-Sentinel"
    Environment = "development"
  }
}

