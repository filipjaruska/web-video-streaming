namespace WebWVideoStreamingAPI.Models;

public enum UploadSessionStatus {
    AwaitingUpload = 0,
    Uploading = 1,
    Uploaded = 2,
    Processing = 3,
    Completed = 4,
    Failed = 5,
    Expired = 6
}
