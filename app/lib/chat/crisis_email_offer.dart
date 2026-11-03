import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../sending/sending_backend.dart';
import '../sending/sending_section.dart';
import 'chat_controller.dart';
import 'crisis_card.dart';

// One button, because the card comes before Buddy's reply, and a taller card pushes that off the screen.
const _wantsSomeone = 'Want Buddy to email someone? Choose who.';
const _asksWhom = 'Who should Buddy email for you?';
const _whatHappens =
    'It can be a friend, a family member or Tuttleman Counseling, and it comes from your TUmail. '
    'Nothing goes until you tap Approve. An email can take a while to be read, so if you need someone now, use the numbers above.';
const _noTuttleman =
    "Buddy doesn't have an email address for Tuttleman Counseling. You can call them with the number above, or write their address below if you have one.";
const _writeAddress = 'Write the email address of who should get this, then tap again.';
const _cardMade = "Buddy made a card for you to check and approve. It's the newest thing in the conversation. Nothing has gone yet.";
const _couldNotAsk = "The app couldn't reach Buddy, so it made no card. Check that the backend is running, then try again. The numbers above don't need Buddy.";
const _couldNotSwitch = "The app couldn't reach Buddy, so it may or may not have switched. Check on the You tab, then try again.";

// Plain words the Student can change, written here so that they're there whatever the model does.
const _startingSubject = 'I could use some help';
const _startingBody =
    "Hi,\n\nI'm having a really hard time right now and I could use someone to talk to. Can you reach out to me when you see this?\n\nDrafted with help from Buddy, an AI assistant";

/// The Crisis card's offer to email someone the Student chooses. It only ever leads to an Action card,
/// and the crisis Resources above it wait for none of it, whatever becomes of it.
class CrisisEmailOfferView extends StatefulWidget {
  const CrisisEmailOfferView({super.key, required this.words, required this.chat, required this.openPhone, required this.announce, required this.onOpened});

  final CrisisEmailWords words;
  final ChatController chat;
  final PhoneOpener openPhone;

  /// True when the card has just appeared. An earlier card says nothing out loud when the app opens.
  final bool announce;

  /// The Student has started on the form, so nothing should move it while they type.
  final VoidCallback onOpened;

  @override
  State<CrisisEmailOfferView> createState() => _CrisisEmailOfferViewState();
}

class _CrisisEmailOfferViewState extends State<CrisisEmailOfferView> {
  late final _name = TextEditingController(text: widget.words.name);
  late final _address = TextEditingController(text: widget.words.address);
  late final _subject = TextEditingController(text: widget.words.subject ?? _startingSubject);
  late final _body = TextEditingController(text: widget.words.body ?? _startingBody);

  /// Null until the backend has answered, because the card mustn't claim anything it hasn't heard.
  /// If it never does, the form still works, and the backend still says why at the tap.
  CrisisEmailOffer? _offer;

  /// True once the Student has tapped something here, so that what becomes of it is read out.
  bool _tapped = false;
  bool _asking = false;
  String? _status;
  bool _statusIsProblem = false;

  @override
  void initState() {
    super.initState();
    _name.addListener(() => widget.words.name = _name.text);
    _address.addListener(() => widget.words.address = _address.text);
    _subject.addListener(() => widget.words.subject = _subject.text);
    _body.addListener(() => widget.words.body = _body.text);
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final offer = await widget.chat.loadCrisisEmailOffer();
      if (mounted) setState(() => _offer = offer);
    } on Exception {
      return;
    }
  }

  void _say(String? status, {bool problem = false}) {
    if (!mounted) return;
    setState(() {
      _status = status;
      _statusIsProblem = problem;
    });
  }

  void _chooseTuttleman(GuidebookItem tuttleman) {
    _name.text = tuttleman.name;
    _address.text = tuttleman.email ?? '';
  }

  /// Only ever makes a card. The email goes only if the Student taps Approve on it.
  Future<void> _askForCard() async {
    if (_asking) return;
    final address = _address.text.trim();
    setState(() => _tapped = true);
    if (address.isEmpty) return _say(_writeAddress, problem: true);
    setState(() => _asking = true);
    try {
      final refusal = await widget.chat.askForCrisisEmailCard(name: _name.text.trim(), address: address, subject: _subject.text, body: _body.text);
      _say(refusal ?? _cardMade, problem: refusal != null);
    } on Exception {
      _say(_couldNotAsk, problem: true);
    }
    if (mounted) setState(() => _asking = false);
  }

  Future<void> _switchToLive() async {
    setState(() => _tapped = true);
    if (!await askToSwitchToLive(context, goesTo: 'the person you choose')) return;
    try {
      await widget.chat.switchToLive();
      await _load();
      _say(null);
    } on Exception {
      _say(_couldNotSwitch, problem: true);
    }
  }

  Future<void> _openSource(Uri address) async {
    try {
      await widget.openPhone(address);
    } on Exception {
      return;
    }
  }

  Widget _spaced(Widget child) => Padding(padding: const EdgeInsets.only(top: 8), child: child);

  String _whereItGoes(CrisisEmailOffer offer) {
    if (offer.isLive) return 'Live is on, so this email will really go to the person you choose, from your TUmail.';
    final own = offer.ownAddress;
    if (own == null) {
      return "Practice mode is on, so this email would go to you, not to the person you choose, and Buddy doesn't know your TUmail address yet. Add it on the You tab, or switch to Live.";
    }
    return 'Practice mode is on, so this email will go to you at $own, not to the person you choose.';
  }

  List<Widget> _form(ThemeData theme, CrisisEmailOffer? offer) {
    final tuttleman = offer?.tuttleman;
    final source = tuttleman?.sources.firstOrNull;
    final sourceAddress = source == null ? null : Uri.tryParse(source.url);
    return [
      _spaced(Semantics(header: true, child: Text(_asksWhom, style: theme.textTheme.titleSmall))),
      _spaced(Semantics(container: true, child: const Text(_whatHappens))),
      if (offer != null) ...[
        _spaced(Semantics(container: true, liveRegion: _tapped, child: Text(_whereItGoes(offer)))),
        if (!offer.isLive) _spaced(OutlinedButton(onPressed: _switchToLive, child: const Text('Switch to Live'))),
      ],
      if (tuttleman != null) ...[
        _spaced(OutlinedButton(onPressed: () => _chooseTuttleman(tuttleman), child: Text('Email ${tuttleman.name}'))),
        if (source != null)
          TextButton(
            onPressed: sourceAddress?.scheme == 'https' ? () => _openSource(sourceAddress!) : null,
            child: Text('Source: ${source.title}', semanticsLabel: 'Open Source: ${source.title}'),
          ),
      ] else if (offer != null)
        _spaced(Semantics(container: true, child: Text(_noTuttleman, style: theme.textTheme.bodySmall))),
      _spaced(TextField(controller: _name, decoration: const InputDecoration(labelText: 'Their name (you can leave this out)'))),
      _spaced(TextField(
        controller: _address,
        keyboardType: TextInputType.emailAddress,
        autocorrect: false,
        enableSuggestions: false,
        decoration: const InputDecoration(labelText: 'Their email address'),
      )),
      _spaced(TextField(controller: _subject, decoration: const InputDecoration(labelText: 'Subject'))),
      _spaced(TextField(
        controller: _body,
        minLines: 4,
        maxLines: null,
        keyboardType: TextInputType.multiline,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(labelText: 'Message'),
      )),
      _spaced(FilledButton(onPressed: _asking ? null : _askForCard, child: const Text('Show me the email'))),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final offer = _offer;
    final whyNotYet = offer?.whyNotYet;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (whyNotYet != null) ...[
          _spaced(Semantics(
            container: true,
            liveRegion: widget.announce || _tapped,
            child: Text(whyNotYet, style: TextStyle(color: colors.error)),
          )),
          _spaced(OutlinedButton(
            onPressed: () {
              setState(() => _tapped = true);
              _load();
            },
            child: const Text('Check again', semanticsLabel: 'Check again whether Buddy can send this email'),
          )),
        ] else if (widget.words.isOpen)
          ..._form(theme, offer)
        else
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: OutlinedButton(
              onPressed: () {
                widget.onOpened();
                setState(() => widget.words.isOpen = true);
              },
              child: const Text(_wantsSomeone),
            ),
          ),
        if (_status case final status?)
          _spaced(Semantics(
            container: true,
            liveRegion: true,
            child: Text(status, style: _statusIsProblem ? TextStyle(color: colors.error) : null),
          )),
      ],
    );
  }
}
