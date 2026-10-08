package com.neighbouraid.updater;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Pure-Java bounded streaming verifier, run off the Android UI/bridge thread. */
final class UpdateIntegrity {
    enum Result { VERIFIED, LEGACY, SIZE_MISMATCH, CHECKSUM_MISMATCH, INVALID_METADATA, INVALID_FILE }

    static boolean validMetadata(String sha256, long expectedSize) {
        return expectedSize >= 0 && expectedSize <= UpdatePolicy.MAX_BYTES
            && (sha256 == null || sha256.matches("[a-f0-9]{64}"));
    }

    static Result verify(File file, String sha256, long expectedSize) throws IOException {
        if (!validMetadata(sha256, expectedSize)) return Result.INVALID_METADATA;
        long length = file.length();
        if (!file.isFile() || length <= 0 || length > UpdatePolicy.MAX_BYTES) return Result.INVALID_FILE;
        if (expectedSize > 0 && length != expectedSize) return Result.SIZE_MISMATCH;
        if (sha256 == null) return Result.LEGACY; // Not a checksum-verification claim.
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
        long total = 0;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Update verification cancelled");
                total += count;
                if (total > UpdatePolicy.MAX_BYTES) return Result.INVALID_FILE;
                if (expectedSize > 0 && total > expectedSize) return Result.SIZE_MISMATCH;
                digest.update(buffer, 0, count);
            }
        }
        if (total != length || (expectedSize > 0 && total != expectedSize)) return Result.SIZE_MISMATCH;
        StringBuilder actual = new StringBuilder(64);
        for (byte value : digest.digest()) actual.append(String.format("%02x", value & 0xff));
        return MessageDigest.isEqual(actual.toString().getBytes(java.nio.charset.StandardCharsets.US_ASCII),
            sha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII)) ? Result.VERIFIED : Result.CHECKSUM_MISMATCH;
    }
}
