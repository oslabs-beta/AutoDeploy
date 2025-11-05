# Jenkins Docker

Dockerfile:

```python
# Jenkins LTS (with JDK 17). The current LTS line (>= 2.492.3) meets the MCP plugin minimum requirement.
FROM jenkins/jenkins:lts-jdk17

USER root

# Install base tools (git, curl, certificates).
# If you use dedicated Jenkins agents, also install git inside your agent images.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Switch back to jenkins user
USER jenkins

# Preinstall plugins:
# MCP Server, Git, Git Client, GitHub integration, Pipeline, and Credentials
# Note: jenkins-plugin-cli is included in the official Jenkins image.
RUN jenkins-plugin-cli --plugins \
  mcp-server \
  git \
  git-client \
  github \
  github-branch-source \
  workflow-aggregator \
  credentials \
  ssh-credentials \
  configuration-as-code

# Expose ports
EXPOSE 8080 50000

# (Optional) Jenkins startup parameters
# Disable the setup wizard on first startup:
# ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"

# (Optional) Mount JCasC configuration file
# ENV CASC_JENKINS_CONFIG=/var/jenkins_home/casc.yaml
```

build:

```python
docker build -t jks:latest .
```

Run: you can change the first 8080 to whatever port you like. 

```python
docker run -d --name jks -p 8080:8080 jks:latest
```

login to docker server :

```python
docker exec -it jks bash
cat /var/jenkins_home/secrets/initialAdminPassword # to get admin password.
then don't install anything close all the tag, when you hit 
"start to use jenkins" click that one. you will be able to use Jenkins.
it is in localhost:8080

```