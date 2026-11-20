package com.mavytech.newsmaker;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** Saves a finished video into the phone's Gallery (Movies/Newsdesk) and keeps the screen on while a video is made. */
@CapacitorPlugin(name = "SaveVideo")
public class SaveVideoPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String uriStr = call.getString("uri");
        String name = call.getString("name", "newsdesk-video.mp4");
        if (uriStr == null) { call.reject("No file"); return; }
        final String fname = name.replaceAll("[^A-Za-z0-9._-]+", "_");
        new Thread(() -> {
            try {
                File src = new File(Uri.parse(uriStr).getPath());
                if (!src.exists()) { call.reject("File not found"); return; }
                String saved;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Video.Media.DISPLAY_NAME, fname);
                    v.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                    v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Newsdesk");
                    v.put(MediaStore.Video.Media.IS_PENDING, 1);
                    Uri out = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
                    if (out == null) { call.reject("Could not create the video in Gallery"); return; }
                    try (InputStream in = new FileInputStream(src); OutputStream os = cr.openOutputStream(out)) { copy(in, os); }
                    v.clear();
                    v.put(MediaStore.Video.Media.IS_PENDING, 0);
                    cr.update(out, v, null, null);
                    saved = out.toString();
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "Newsdesk");
                    if (!dir.exists()) dir.mkdirs();
                    File dst = new File(dir, fname);
                    try (InputStream in = new FileInputStream(src); OutputStream os = new FileOutputStream(dst)) { copy(in, os); }
                    MediaScannerConnection.scanFile(getContext(), new String[]{dst.getAbsolutePath()}, new String[]{"video/mp4"}, null);
                    saved = dst.getAbsolutePath();
                }
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("saved", saved);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not save: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void awake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    private static void copy(InputStream in, OutputStream os) throws java.io.IOException {
        byte[] b = new byte[1 << 20];
        int n;
        while ((n = in.read(b)) > 0) os.write(b, 0, n);
        os.flush();
    }
}
