package com.mavytech.newsmaker;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** In-app gallery: lists the phone's videos and photos (newest first) and makes small thumbnails. */
@CapacitorPlugin(
    name = "Gallery",
    permissions = {
        @Permission(alias = "media13", strings = { Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_IMAGES }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class GalleryPlugin extends Plugin {
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    private String alias() { return Build.VERSION.SDK_INT >= 33 ? "media13" : "storage"; }

    private boolean granted() { return getPermissionState(alias()) == PermissionState.GRANTED; }

    @PluginMethod
    public void perm(PluginCall call) {
        if (granted()) { JSObject r = new JSObject(); r.put("ok", true); call.resolve(r); return; }
        requestPermissionForAlias(alias(), call, "permCb");
    }

    @PermissionCallback
    private void permCb(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void list(PluginCall call) {
        final String type = call.getString("type", "video");
        final int off = call.getInt("offset", 0);
        final int lim = call.getInt("limit", 60);
        pool.execute(() -> {
            Cursor c = null;
            try {
                boolean img = "image".equals(type);
                Uri col = img ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
                String[] proj = img
                    ? new String[] { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.MIME_TYPE }
                    : new String[] { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.MIME_TYPE, MediaStore.Video.Media.DURATION };
                c = getContext().getContentResolver().query(col, proj, null, null, MediaStore.MediaColumns.DATE_ADDED + " DESC");
                JSArray arr = new JSArray();
                int total = 0;
                if (c != null) {
                    total = c.getCount();
                    if (c.moveToPosition(off)) {
                        int n = 0;
                        do {
                            long id = c.getLong(0);
                            JSObject o = new JSObject();
                            o.put("uri", ContentUris.withAppendedId(col, id).toString());
                            o.put("name", c.getString(1));
                            o.put("size", c.getLong(2));
                            o.put("mime", c.getString(3));
                            if (!img) o.put("dur", c.getLong(4));
                            arr.put(o);
                            n++;
                        } while (n < lim && c.moveToNext());
                    }
                }
                JSObject r = new JSObject();
                r.put("items", arr);
                r.put("total", total);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not read the gallery: " + e.getMessage());
            } finally {
                if (c != null) c.close();
            }
        });
    }

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void thumb(PluginCall call) {
        final String us = call.getString("uri");
        if (us == null) { call.reject("no uri"); return; }
        pool.execute(() -> {
            try {
                Uri u = Uri.parse(us);
                ContentResolver cr = getContext().getContentResolver();
                Bitmap b;
                if (Build.VERSION.SDK_INT >= 29) {
                    b = cr.loadThumbnail(u, new Size(256, 256), null);
                } else {
                    long id = ContentUris.parseId(u);
                    b = us.contains("/video/")
                        ? MediaStore.Video.Thumbnails.getThumbnail(cr, id, MediaStore.Video.Thumbnails.MINI_KIND, null)
                        : MediaStore.Images.Thumbnails.getThumbnail(cr, id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                }
                if (b == null) { call.reject("no thumbnail"); return; }
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                b.compress(Bitmap.CompressFormat.JPEG, 70, bo);
                JSObject r = new JSObject();
                r.put("data", "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("thumb: " + e.getMessage());
            }
        });
    }
}
