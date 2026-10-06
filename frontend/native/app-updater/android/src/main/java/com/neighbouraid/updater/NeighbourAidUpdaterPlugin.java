package com.neighbouraid.updater;

import android.app.DownloadManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.Arrays;

/** DownloadManager keeps an explicitly started download alive across app closes.
 * Only this app's package, exact newer version and current signer are offered
 * to the Android installer. No silent install, uninstall or public storage.
 */
@CapacitorPlugin(name = "NeighbourAidUpdater")
public class NeighbourAidUpdaterPlugin extends Plugin {
    private SharedPreferences state() { return getContext().getSharedPreferences("neighbouraid-updater", Context.MODE_PRIVATE); }
    private DownloadManager manager() { return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE); }
    private PackageInfo installed() throws PackageManager.NameNotFoundException {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags());
    }
    private int signatureFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    @SuppressWarnings("deprecation")
    private long version(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    @SuppressWarnings("deprecation")
    private byte[][] signers(PackageInfo info) {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        return signatures == null ? null : Arrays.stream(signatures).map(Signature::toByteArray).toArray(byte[][]::new);
    }
    private File apk(int code) throws Exception {
        File root = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (root == null) throw new IllegalStateException("Update storage unavailable");
        File folder = new File(root, "app-updates");
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IllegalStateException("Update storage unavailable");
        return new File(folder, "update-" + code + ".apk");
    }
    private void clearDownload() {
        long id = state().getLong("downloadId", -1);
        if (id != -1) manager().remove(id); // Only this updater's stored, owned download.
        state().edit().clear().apply();
    }
    private JSObject status() throws Exception {
        JSObject result = new JSObject();
        result.put("state", "idle");
        int code = state().getInt("versionCode", 0);
        long id = state().getLong("downloadId", -1);
        if (id == -1) return result;
        if (code <= version(installed())) { clearDownload(); return result; }
        result.put("versionCode", code);
        try (Cursor cursor = manager().query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) { result.put("state", "failed"); return result; }
            int downloadStatus = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            if (bytes > UpdatePolicy.MAX_BYTES || total > UpdatePolicy.MAX_BYTES) {
                clearDownload(); result.put("state", "failed"); return result;
            }
            result.put("percent", total > 0 ? Math.min(100, Math.max(0, bytes * 100 / total)) : 0);
            result.put("state", switch (downloadStatus) {
                case DownloadManager.STATUS_SUCCESSFUL -> "ready";
                case DownloadManager.STATUS_FAILED -> "failed";
                case DownloadManager.STATUS_PAUSED -> "paused";
                default -> "downloading";
            });
            return result;
        }
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        try {
            String url = call.getString("url");
            Integer code = call.getInt("versionCode");
            if (!UpdatePolicy.trustedDownload(url) || code == null || !UpdatePolicy.acceptableVersion(code, code, version(installed()))) {
                call.reject("Invalid update", "INVALID_UPDATE"); return;
            }
            JSObject previous = status();
            if (state().getInt("versionCode", 0) == code && !"failed".equals(previous.getString("state")) && !"idle".equals(previous.getString("state"))) {
                call.resolve(previous); return; // Do not duplicate a resumed download.
            }
            clearDownload();
            File destination = apk(code);
            if (destination.exists() && !destination.delete()) throw new IllegalStateException("Cannot replace old update file");
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle("NeighbourAid update")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, "app-updates/" + destination.getName());
            long id = manager().enqueue(request);
            state().edit().putLong("downloadId", id).putInt("versionCode", code).apply();
            call.resolve(status());
        } catch (Exception e) { call.reject("Could not start update download", "DOWNLOAD_FAILED", e); }
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        try { call.resolve(status()); }
        catch (Exception e) { call.reject("Could not read update progress", "DOWNLOAD_FAILED", e); }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        try { clearDownload(); call.resolve(); }
        catch (Exception e) { call.reject("Could not cancel update", "DOWNLOAD_FAILED", e); }
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        try {
            if (!"ready".equals(status().getString("state"))) { call.reject("Download is not complete", "NOT_READY"); return; }
            int expected = state().getInt("versionCode", 0);
            File file = apk(expected);
            PackageManager pm = getContext().getPackageManager();
            PackageInfo current = installed();
            PackageInfo candidate = pm.getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
            if (!file.isFile() || file.length() == 0 || file.length() > UpdatePolicy.MAX_BYTES || candidate == null
                    || !current.packageName.equals(candidate.packageName)
                    || !UpdatePolicy.acceptableVersion(expected, version(candidate), version(current))) {
                call.reject("APK does not match the expected update", "INVALID_APK"); return;
            }
            if (!UpdatePolicy.sameSigners(signers(current), signers(candidate))) {
                call.reject("APK signing key differs from the installed app. Nothing was uninstalled.", "SIGNATURE_MISMATCH"); return;
            }
            getActivity().runOnUiThread(() -> {
                try {
                    JSObject result = new JSObject();
                    if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
                        getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getContext().getPackageName())));
                        result.put("state", "permission");
                    } else {
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".neighbouraid.updates", file);
                        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.setClipData(ClipData.newRawUri("NeighbourAid update", uri));
                        getActivity().startActivity(intent);
                        result.put("state", "installer"); // Intent opened, NOT proof installation succeeded.
                    }
                    call.resolve(result);
                } catch (Exception e) { call.reject("Could not open Android installer", "INSTALL_FAILED", e); }
            });
        } catch (Exception e) { call.reject("Could not validate update", "INSTALL_FAILED", e); }
    }
}
