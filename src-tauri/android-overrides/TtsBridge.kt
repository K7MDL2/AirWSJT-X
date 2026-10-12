package us.ad7np.airwsjtx

import android.content.Context
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import java.util.Locale

/** Exposes Android's native text-to-speech to the WebView as `window.AndroidTts`. */
class TtsBridge(context: Context) : TextToSpeech.OnInitListener {
    private val tts = TextToSpeech(context.applicationContext, this)
    @Volatile private var ready = false
    @Volatile private var pending: String? = null

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) return
        tts.language = Locale.getDefault()
        ready = true
        pending?.let { pending = null; speak(it) }
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @JavascriptInterface
    fun speak(text: String) {
        if (!ready) {
            pending = text
            return
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "airwsjtx-callout")
    }

    @JavascriptInterface
    fun stop() {
        tts.stop()
    }

    fun shutdown() {
        tts.stop()
        tts.shutdown()
    }
}
