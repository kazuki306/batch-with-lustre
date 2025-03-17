FROM --platform=linux/amd64 ubuntu:20.04

# Set non-interactive installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Tokyo

# Update package lists
RUN apt-get update

# Install essential packages first
RUN apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    gnupg2

# Install additional packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    software-properties-common \
    bc \
    sudo \
    unzip

# Install Lustre client
RUN wget -O - https://fsx-lustre-client-repo-public-keys.s3.amazonaws.com/fsx-ubuntu-public-key.asc | gpg --dearmor | tee /usr/share/keyrings/fsx-ubuntu-public-key.gpg >/dev/null \
    && bash -c 'echo "deb [signed-by=/usr/share/keyrings/fsx-ubuntu-public-key.gpg] https://fsx-lustre-client-repo.s3.amazonaws.com/ubuntu focal main" > /etc/apt/sources.list.d/fsxlustreclientrepo.list' \
    && apt-get update \
    && apt-get install -y \
    linux-aws \
    lustre-client-modules-aws

# Clean up
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shell script
COPY lustre/write_delete_test_lustre.sh .

# Make script executable
RUN chmod +x write_delete_test_lustre.sh

# Set default command (デフォルトで10回の書き込み、200GBのファイルサイズ、/scratch ディレクトリ)
CMD ["./write_delete_test_lustre.sh", "10", "200", "/scratch"]