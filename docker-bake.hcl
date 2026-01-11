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

variable "CACHE_REPO" {
  default = ""
}

// Shared settings for all targets
group "default" {
  targets = ["agent-api", "web-api", "web-app"]
}

target "base" {
  context = "."
  dockerfile = "Dockerfile"
  secret = ["id=npmrc,src=.npmrc"]
  cache-from = CACHE_REPO != "" ? ["type=registry,ref=${CACHE_REPO}:cache"] : []
  cache-to = CACHE_REPO != "" ? ["type=registry,ref=${CACHE_REPO}:cache,mode=max"] : []
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
