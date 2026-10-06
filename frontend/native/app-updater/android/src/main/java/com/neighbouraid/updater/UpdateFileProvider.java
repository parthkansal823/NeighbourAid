package com.neighbouraid.updater;

import androidx.core.content.FileProvider;

/** Separate, non-exported provider limited to the updater's own APK folder. */
public final class UpdateFileProvider extends FileProvider {}
