package com.cuenote.backend.api.storage;

import com.cuenote.backend.api.error.ApiException;
import com.cuenote.backend.api.error.ErrorCode;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.errors.MinioException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "cuenote.object-storage.type", havingValue = "minio")
public class MinioObjectStorageService implements ObjectStorageService {

    private final MinioClient client;
    private final String bucket;

    public MinioObjectStorageService(
            @Value("${cuenote.object-storage.minio.endpoint}") String endpoint,
            @Value("${cuenote.object-storage.minio.access-key}") String accessKey,
            @Value("${cuenote.object-storage.minio.secret-key}") String secretKey,
            @Value("${cuenote.object-storage.minio.bucket:cuenote-scores}") String bucket
    ) {
        this.client = MinioClient.builder()
                .endpoint(endpoint)
                .credentials(accessKey, secretKey)
                .build();
        this.bucket = bucket;
        ensureBucket();
    }

    @Override
    public StoredObject put(String key, byte[] content, String contentType) {
        try {
            client.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucket)
                            .object(key)
                            .contentType(contentType)
                            .stream(new ByteArrayInputStream(content), content.length, -1)
                            .build()
            );
            return new StoredObject(key, content, contentType);
        } catch (IOException | InvalidKeyException | NoSuchAlgorithmException | MinioException exception) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Object storage write failed");
        }
    }

    @Override
    public StoredObject get(String key) {
        try (var stream = client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build())) {
            var stat = client.statObject(StatObjectArgs.builder().bucket(bucket).object(key).build());
            return new StoredObject(key, stream.readAllBytes(), stat.contentType());
        } catch (IOException | InvalidKeyException | NoSuchAlgorithmException | MinioException exception) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Stored object not found");
        }
    }

    private void ensureBucket() {
        try {
            boolean exists = client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build());
            if (!exists) {
                client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            }
        } catch (IOException | InvalidKeyException | NoSuchAlgorithmException | MinioException exception) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Object storage bucket initialization failed");
        }
    }
}
