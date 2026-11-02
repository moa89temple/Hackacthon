package dev.hackathon.buddy

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// A FragmentActivity, because the fingerprint prompt needs one.
class MainActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "buddy/outlook").setMethodCallHandler { call, result ->
            if (call.method == "compose") {
                result.success(composeInOutlook(call.argument("to"), call.argument("subject") ?: "", call.argument("body") ?: ""))
            } else {
                result.notImplemented()
            }
        }
    }

    // Android's own way to start an email, aimed at Microsoft's app so that it can't open another
    // mail account's app. The Student sends it from there, and Buddy hears nothing more about it.
    private fun composeInOutlook(to: String?, subject: String, body: String): Boolean {
        val email = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).apply {
            setPackage("com.microsoft.office.outlook")
            if (to != null) putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
        }
        return try {
            startActivity(email)
            true
        } catch (_: RuntimeException) {
            // Not installed, or a message too big to hand over. Either way, the app falls back.
            false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keeps the app switcher from showing a picture of what was on the screen when Buddy locked.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false)
        }
    }
}
