// Docker Buildx Bake configuration
// Build all images with shared cache: docker buildx bake --push

variable "REGISTRY" {
  default = ""
}

variable "TAG" {
  default = "latest"
}

variable "AGENT_API_PORT" {
  default = "61664"
}

// Shared settings for all targets
group "default" {
  targets = ["agent-api", "web-api", "web-app"]
}

target "base" {
  context = "."
  dockerfile = "Dockerfile"
}

target "agent-api" {
  inherits = ["base"]
  target = "agent-api"
  tags = [
    "${REGISTRY}pippa-agent:${TAG}",
    "${REGISTRY}pippa-agent:latest"
  ]
  platforms = ["linux/arm64"]
}

target "web-api" {
  inherits = ["base"]
  target = "web-api"
  tags = [
    "${REGISTRY}pippa-api:${TAG}",
    "${REGISTRY}pippa-api:latest"
  ]
  platforms = ["linux/arm64"]
}

target "web-app" {
  inherits = ["base"]
  target = "web-app"
  args = {
    AGENT_API_PORT = "${AGENT_API_PORT}"
  }
  tags = [
    "${REGISTRY}pippa-app:${TAG}",
    "${REGISTRY}pippa-app:latest"
  ]
  platforms = ["linux/arm64"]
}
