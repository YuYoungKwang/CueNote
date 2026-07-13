package com.cuenote.backend.api.storage;

import com.cuenote.backend.api.error.ApiException;
import com.cuenote.backend.api.error.ErrorCode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "cuenote.object-storage.type", havingValue = "local", matchIfMissing = true)
public class LocalObjectStorageService implements ObjectStorageService {

    private final Path root;

    public LocalObjectStorageService(@Value("${cuenote.object-storage.local-root:target/object-storage}") String root) {
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    @Override
    public StoredObject put(String key, byte[] content, String contentType) {
        try {
            Path destination = resolveKey(key);
            Files.createDirectories(destination.getParent());
            Files.write(destination, content);
            Files.writeString(destination.resolveSibling(destination.getFileName() + ".content-type"), contentType);
            return new StoredObject(key, content, contentType);
        } catch (IOException exception) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Object storage write failed");
        }
    }

    @Override
    public StoredObject get(String key) {
        try {
            Path source = resolveKey(key);
            if (!Files.exists(source)) {
                throw new ApiException(ErrorCode.NOT_FOUND, "Stored object not found");
            }
            String contentType = Files.exists(source.resolveSibling(source.getFileName() + ".content-type"))
                    ? Files.readString(source.resolveSibling(source.getFileName() + ".content-type"))
                    : "application/xml";
            return new StoredObject(key, Files.readAllBytes(source), contentType);
        } catch (IOException exception) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Object storage read failed");
        }
    }

    private Path resolveKey(String key) {
        Path resolved = root.resolve(key).normalize();
        if (!resolved.startsWith(root)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Invalid object key");
        }
        return resolved;
    }
}
