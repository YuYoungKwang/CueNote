package com.cuenote.backend.api.storage;

public interface ObjectStorageService {
    StoredObject put(String key, byte[] content, String contentType);

    StoredObject get(String key);

    record StoredObject(String key, byte[] content, String contentType) {
    }
}
