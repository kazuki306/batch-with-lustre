FROM --platform=linux/amd64 ubuntu:20.04

# Set non-interactive installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Tokyo

# Install basic dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg2 \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Add deadsnakes PPA for Python 3.10
RUN add-apt-repository ppa:deadsnakes/ppa

# Install Python 3.10 and pip
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3.10-distutils \
    && rm -rf /var/lib/apt/lists/*

# Install pip for Python 3.10
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.10

# Install Lustre client
RUN wget -O - https://fsx-lustre-client-repo-public-keys.s3.amazonaws.com/fsx-ubuntu-public-key.asc | gpg --dearmor | tee /usr/share/keyrings/fsx-ubuntu-public-key.gpg >/dev/null \
    && bash -c 'echo "deb [signed-by=/usr/share/keyrings/fsx-ubuntu-public-key.gpg] https://fsx-lustre-client-repo.s3.amazonaws.com/ubuntu focal main" > /etc/apt/sources.list.d/fsxlustreclientrepo.list' \
    && apt-get update \
    && apt-get install -y \
    linux-aws \
    lustre-client-modules-aws \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Update pip and install requirements
COPY requirements.txt .
RUN python3.10 -m pip install --no-cache-dir --upgrade pip && \
    python3.10 -m pip install --no-cache-dir -r requirements.txt

COPY src/ .

CMD ["python3.10", "lustre_striping.py"]