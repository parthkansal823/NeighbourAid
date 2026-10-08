package com.neighbouraid.updater;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InterruptedIOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class UpdateIntegrityTest {
    private static final String ABC_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    @Rule public TemporaryFolder folder = new TemporaryFolder();

    private File contents(String value) throws Exception {
        File file = folder.newFile();
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(value.getBytes(StandardCharsets.UTF_8)); }
        return file;
    }

    @Test public void verifiesKnownSha256AndExactSize() throws Exception {
        assertEquals(UpdateIntegrity.Result.VERIFIED, UpdateIntegrity.verify(contents("abc"), ABC_SHA, 3));
        assertEquals(UpdateIntegrity.Result.VERIFIED, UpdateIntegrity.verify(contents("abc"), ABC_SHA, 0));
    }
    @Test public void legacyReleaseNeverClaimsChecksumVerification() throws Exception {
        assertEquals(UpdateIntegrity.Result.LEGACY, UpdateIntegrity.verify(contents("abc"), null, 0));
        assertEquals(UpdateIntegrity.Result.LEGACY, UpdateIntegrity.verify(contents("abc"), null, 3));
    }
    @Test public void corruptionAndUnexpectedSizeAreRejected() throws Exception {
        assertEquals(UpdateIntegrity.Result.CHECKSUM_MISMATCH, UpdateIntegrity.verify(contents("abd"), ABC_SHA, 3));
        assertEquals(UpdateIntegrity.Result.SIZE_MISMATCH, UpdateIntegrity.verify(contents("abc"), ABC_SHA, 4));
        assertEquals(UpdateIntegrity.Result.SIZE_MISMATCH, UpdateIntegrity.verify(contents("abc"), null, 2));
    }
    @Test public void missingEmptyDirectoryAndOversizedFilesAreRejected() throws Exception {
        assertEquals(UpdateIntegrity.Result.INVALID_FILE, UpdateIntegrity.verify(contents(""), ABC_SHA, 0));
        assertEquals(UpdateIntegrity.Result.INVALID_FILE, UpdateIntegrity.verify(new File(folder.getRoot(), "missing.apk"), ABC_SHA, 0));
        assertEquals(UpdateIntegrity.Result.INVALID_FILE, UpdateIntegrity.verify(folder.getRoot(), ABC_SHA, 0));
        File large = folder.newFile();
        try (RandomAccessFile file = new RandomAccessFile(large, "rw")) { file.setLength(UpdatePolicy.MAX_BYTES + 1); }
        assertEquals(UpdateIntegrity.Result.INVALID_FILE, UpdateIntegrity.verify(large, ABC_SHA, 0));
    }
    @Test public void malformedMetadataCannotBypassChecks() throws Exception {
        for (String invalid : new String[] {"", "bad", ABC_SHA.toUpperCase(), "sha256:" + ABC_SHA}) {
            assertFalse(UpdateIntegrity.validMetadata(invalid, 3));
            assertEquals(UpdateIntegrity.Result.INVALID_METADATA, UpdateIntegrity.verify(contents("abc"), invalid, 3));
        }
        assertFalse(UpdateIntegrity.validMetadata(null, -1));
        assertFalse(UpdateIntegrity.validMetadata(null, UpdatePolicy.MAX_BYTES + 1));
    }
    @Test public void interruptedWorkerStopsWithoutOpeningInstaller() throws Exception {
        Thread.currentThread().interrupt();
        try {
            UpdateIntegrity.verify(contents("abc"), ABC_SHA, 3);
            fail("Expected cancellation");
        } catch (InterruptedIOException expected) {
            assertTrue(Thread.currentThread().isInterrupted());
        } finally { Thread.interrupted(); }
    }
}
