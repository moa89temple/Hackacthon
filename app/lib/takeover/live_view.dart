import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Builds the live view of Buddy's Browser. Tests replace it, since a WebView needs a real phone.
typedef LiveViewBuilder = Widget Function(Uri url);

Widget webLiveView(Uri url) => _LiveView(url: url);

/// Shows the page the backend serves for the live view. Everything in it, including the
/// connection to the browser itself, goes through the backend.
class _LiveView extends StatefulWidget {
  const _LiveView({required this.url});

  final Uri url;

  @override
  State<_LiveView> createState() => _LiveViewState();
}

class _LiveViewState extends State<_LiveView> {
  late final WebViewController _controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setBackgroundColor(Colors.black)
    ..loadRequest(widget.url);

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}
