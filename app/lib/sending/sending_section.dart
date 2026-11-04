import 'package:flutter/material.dart';

import '../design/parts.dart';
import 'sending_controller.dart';

/// Asks before the switch to Live, wherever the Student started it. True only if they said yes.
Future<bool> askToSwitchToLive(BuildContext context, {String goesTo = 'the Contact', String cardsStopping = 'Any card waiting for a tap stops working'}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      scrollable: true,
      title: const Text('Switch to Live?'),
      content: Text(
        "What you approve will really go to $goesTo, from your TUmail, and it can't be taken back. "
        'Buddy still sends nothing without your Approve tap. $cardsStopping, and you can switch back at any time.',
      ),
      actionsOverflowButtonSpacing: 4,
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Stay in Practice mode')),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Switch to Live')),
      ],
    ),
  );
  return confirmed == true;
}

/// The Student's control over where what Buddy sends goes. The only other ways to Live are the Student's
/// taps on the Crisis card's offer and on the Action card it makes, and nothing Buddy reads or writes can reach any of them.
class SendingScreen extends StatefulWidget {
  const SendingScreen({super.key, required this.sending});

  final SendingController sending;

  @override
  State<SendingScreen> createState() => _SendingScreenState();
}

class _SendingScreenState extends State<SendingScreen> {
  final _address = TextEditingController();

  /// Fills the field once, and never over what the Student is typing.
  bool _filledIn = false;

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  Future<void> _askAboutLive() async {
    if (await askToSwitchToLive(context)) await widget.sending.switchToLive();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.sending,
      builder: (context, _) {
        final sending = widget.sending;
        final settings = sending.settings;
        if (settings != null && !_filledIn) {
          _filledIn = true;
          _address.text = settings.ownAddress ?? '';
        }
        return SubScreen(
          title: 'Email Buddy sends',
          children: [
            if (sending.couldNotLoad)
              EmptyState(
                icon: Icons.mail_outline,
                isProblem: true,
                words: "The app can't reach Buddy right now. Check that the backend is running.",
                action: AppLink('Try again', semanticsLabel: 'Try loading sending again', onPressed: sending.load),
              )
            else if (settings == null)
              const LoadingBlock(label: 'Loading where Buddy sends email')
            else ...[
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: settings.isLive
                    ? const Pill('Live', tone: PillTone.solidCherry, icon: Icons.send)
                    : const Pill('Practice mode'),
              ),
              const SizedBox(height: 8),
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
              const SizedBox(height: 28),
              ScreenSection(
                title: 'Your TUmail address',
                children: [
                  if (settings.ownAddress case final address?)
                    Text('Practice emails go to $address. Check that this is really yours, because Buddy sends real email there.')
                  else
                    const Text("Buddy doesn't know your TUmail address yet, so it can't send anything in Practice mode."),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _address,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(labelText: 'Your TUmail address', hintText: 'you@temple.edu'),
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: sending.isChanging ? null : () => sending.saveOwnAddress(_address.text),
                    child: const Text('Save your address'),
                  ),
                ],
              ),
              if (sending.problem case final problem?) ProblemNote(problem),
            ],
          ],
        );
      },
    );
  }
}
