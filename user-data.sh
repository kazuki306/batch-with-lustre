Content-Type: multipart/mixed; boundary="==MYBOUNDARY=="
MIME-Version: 1.0

--==MYBOUNDARY==
Content-Type: text/cloud-boothook; charset="us-ascii"

file_system_id=${FSX_FILESYSTEM_ID}
region=${AWS_REGION}
fsx_directory=/scratch
fsx_mount_name=${FSX_MOUNT_NAME}

amazon-linux-extras install -y lustre2.10
mkdir -p ${fsx_directory}
mount -t lustre -o noatime,flock ${file_system_id}.fsx.${region}.amazonaws.com@tcp:/${fsx_mount_name} ${fsx_directory}

--==MYBOUNDARY==--