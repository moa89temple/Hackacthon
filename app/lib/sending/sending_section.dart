import 'package:flutter/material.dart';

import 'sending_controller.dart';

/// The You tab's control over where what Buddy sends goes. This is the only place in the app that can
/// switch to Live, and nothing Buddy reads or writes can reach it.
class SendingSection extends StatefulWidget {
  const SendingSection({super.key, required this.sending});

  final SendingController sending;

  @override
  State<SendingSection> createState() => _SendingSectionState();
}

class _SendingSectionState extends State<SendingSection> {
  final _address = TextEditingController();

  /// Fills the field once, and never over what the Student is typing.
  bool _filledIn = false;

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  Future<void> _askAboutLive() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Switch to Live?'),
        content: const Text(
          "What you approve will really go to the Contact, from your TUmail, and it can't be taken back. "
          'Buddy still sends nothing without your Approve tap. Any card waiting for a tap stops working, and you can switch back at any time.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Stay in Practice mode')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Switch to Live')),
        ],
      ),
    );
    if (confirmed == true) await widget.sending.switchToLive();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: widget.sending,
      builder: (context, _) {
        final sending = widget.sending;
        final settings = sending.settings;
        if (settings != null && !_filledIn) {
          _filledIn = true;
          _address.text = settings.ownAddress ?? '';
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text('Email Buddy sends', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 8),
            if (sending.couldNotLoad) ...[
              Semantics(
                liveRegion: true,
                child: const Text("The app can't reach Buddy right now. Check that the backend is running."),
              ),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton(onPressed: sending.load, child: const Text('Try again', semanticsLabel: 'Try loading sending again')),
              ),
            ] else if (settings == null)
              const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading where Buddy sends email'))
            else ...[
              Semantics(
                container: true,
                liveRegion: true,
                child: Text(
                  settings.isLive
                      ? 'Live is on. What you approve Buddy to send really goes to the Contact, from your TUmail.'
                      : 'Practice mode is on. What you approve Buddy to send goes to your own TUmail address, not to the Contact.',
                ),
              ),
              const SizedBox(height: 12),
              if (settings.ownAddress case final address?)
                Text('Practice emails go to $address. Check that this is really yours, because Buddy sends real email there.')
              else
                const Text("Buddy doesn't know your TUmail address yet, so it can't send anything in Practice mode."),
              const SizedBox(height: 8),
              TextField(
                controller: _address,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(labelText: 'Your TUmail address', hintText: 'you@temple.edu'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: sending.isChanging ? null : () => sending.saveOwnAddress(_address.text),
                child: const Text('Save your address'),
              ),
              const SizedBox(height: 8),
              if (settings.isLive)
                OutlinedButton(
                  onPressed: sending.isChanging ? null : sending.switchToPractice,
                  child: const Text('Back to Practice mode'),
                )
              else
                OutlinedButton(
                  onPressed: sending.isChanging ? null : _askAboutLive,
                  child: const Text('Switch to Live'),
                ),
              if (sending.problem case final problem?)
                Semantics(
                  container: true,
                  liveRegion: true,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(problem, style: TextStyle(color: theme.colorScheme.error)),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }
}
