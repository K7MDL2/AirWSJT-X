package us.ad7np.airwsjtx

import android.webkit.WebView

class MainActivity : TauriActivity() {
    private var tts: TtsBridge? = null

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        val bridge = TtsBridge(this)
        tts = bridge
        webView.addJavascriptInterface(bridge, "AndroidTts")
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }
}
