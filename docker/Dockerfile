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

# Install AWS CLI v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

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
COPY scripts/write_delete_test_ebs_with_s3.sh .

# Make script executable
RUN chmod +x write_delete_test_ebs_with_s3.sh

# Set default command (デフォルトで10回の書き込み、200GBのファイルサイズ、/scratch ディレクトリ)
# CMD ["./write_delete_test_lustre.sh", "10", "200", "/scratch"]
CMD ["./write_delete_test_ebs_with_s3.sh", "5", "20", "/data", "batchwithebsonlyebsstack-databuckete3889a50-pceotlc6z0be"]
# CMD ["./write_delete_test_ebs_with_s3_sync.sh", "10", "200", "/data", "batchwithebsonlyebsstack-databuckete3889a50-pceotlc6z0be"]