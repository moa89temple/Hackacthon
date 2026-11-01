import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'live_view.dart';

/// The whole screen is the live view of Buddy's Browser, apart from a bar with Done.
/// Closes with the result of Done, or with nothing if the Student left without tapping it.
/// Leaving keeps the Takeover going, so Buddy stays out until the Student taps Done.
class TakeoverScreen extends StatefulWidget {
  const TakeoverScreen({
    super.key,
    required this.backend,
    required this.takeover,
    required this.liveViewBuilder,
  });

  final BuddyBackend backend;
  final Takeover takeover;
  final LiveViewBuilder liveViewBuilder;

  @override
  State<TakeoverScreen> createState() => _TakeoverScreenState();
}

class _TakeoverScreenState extends State<TakeoverScreen> {
  bool _finishing = false;
  bool _couldNotFinish = false;

  Future<void> _done() async {
    setState(() {
      _finishing = true;
      _couldNotFinish = false;
    });
    try {
      final finished = await widget.backend.finishTakeover();
      if (mounted) Navigator.of(context).pop(finished);
    } on Exception {
      if (mounted) {
        setState(() {
          _finishing = false;
          _couldNotFinish = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const BackButton(),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: FilledButton(
                    onPressed: _finishing ? null : _done,
                    child: const Text('Done'),
                  ),
                ),
              ],
            ),
            // Large text scrolls here rather than squeezing the live view off the screen.
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.25),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Semantics(
                      container: true,
                      liveRegion: true,
                      child: const Text("You're in control. Buddy can't see this screen."),
                    ),
                    if (_couldNotFinish)
                      Semantics(
                        container: true,
                        liveRegion: true,
                        child: Text(
                          "The app couldn't reach Buddy. Check that the backend is running, then tap Done again.",
                          style: TextStyle(color: colors.error),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: Semantics(
                container: true,
                label: "Live view of Buddy's Browser, showing ${widget.takeover.siteName}. "
                    "It's a picture of the browser, so a screen reader can't read what's on it.",
                child: widget.liveViewBuilder(widget.takeover.liveViewUrl, widget.takeover.liveViewHeaders),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
