FROM --platform=linux/amd64 ubuntu:20.04

# Set non-interactive installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Tokyo
ENV S3_BUCKET_NAME=""

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

# Clean up
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shell script
COPY ebs/write_delete_test_ebs_with_s3.sh .

# Make script executable
RUN chmod +x write_delete_test_ebs_with_s3.sh

# Set default command (デフォルトで5回の書き込み、20GBのファイルサイズ、/data ディレクトリ)
CMD ["./write_delete_test_ebs_with_s3.sh", "50", "20", "/data"]