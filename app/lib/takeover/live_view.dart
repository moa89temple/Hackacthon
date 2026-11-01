import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Builds the live view of Buddy's Browser. Tests replace it, since a WebView needs a real phone.
typedef LiveViewBuilder = Widget Function(Uri url, Map<String, String> headers);

Widget webLiveView(Uri url, Map<String, String> headers) => _LiveView(url: url, headers: headers);

/// Shows the page the backend serves for the live view. Everything in it, including the
/// connection to the browser itself, goes through the backend. Only the page itself can carry
/// [headers]. The backend answers it with a cookie that lets the page's scripts and socket through.
class _LiveView extends StatefulWidget {
  const _LiveView({required this.url, required this.headers});

  final Uri url;
  final Map<String, String> headers;

  @override
  State<_LiveView> createState() => _LiveViewState();
}

class _LiveViewState extends State<_LiveView> {
  late final WebViewController _controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setBackgroundColor(Colors.black)
    ..loadRequest(widget.url, headers: widget.headers);

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}
