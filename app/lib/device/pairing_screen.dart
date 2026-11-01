import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'pairing_details.dart';
import 'qr_scanner.dart';

const _howToGetCode = 'On your laptop, run npm run pair in the backend folder for a new one.';

/// The first thing a phone sees. Everything else waits until it has a device key.
class PairingScreen extends StatefulWidget {
  const PairingScreen({
    super.key,
    required this.onPair,
    required this.scannerBuilder,
    this.notice,
  });

  /// Pairs with the backend. Throws if that didn't work.
  final Future<void> Function(PairingDetails details) onPair;
  final QrScannerBuilder scannerBuilder;

  /// Why the phone is here, if it was paired before.
  final String? notice;

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  final _address = TextEditingController(text: emulatorAllowed ? emulatorAddress : '');
  final _code = TextEditingController();
  bool _pairing = false;
  String? _problem;

  @override
  void dispose() {
    _address.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final scanned = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (context) => _ScanScreen(scannerBuilder: widget.scannerBuilder)),
    );
    if (scanned == null || !mounted) return;

    final details = PairingDetails.fromQr(scanned);
    if (details == null) {
      setState(() => _problem = "That isn't a Buddy pairing code. $_howToGetCode");
      return;
    }
    await _pair(details);
  }

  Future<void> _pairWithTypedCode() async {
    final code = _code.text.trim();
    if (code.isEmpty) {
      setState(() => _problem = 'Type the code your laptop shows.');
      return;
    }
    final address = parseBackendAddress(_address.text);
    if (address == null) {
      setState(() => _problem = 'The laptop address must start with https://');
      return;
    }
    await _pair(PairingDetails(address: address, code: code));
  }

  Future<void> _pair(PairingDetails details) async {
    setState(() {
      _pairing = true;
      _problem = null;
    });
    try {
      await widget.onPair(details);
    } on PairingRefused {
      _finishWith("That code didn't work. It may have expired or already been used. $_howToGetCode");
    } on Exception {
      _finishWith(
        "Buddy couldn't reach your laptop at ${details.address}. Check that the backend is running "
        'and that Tailscale is on, then try again.',
      );
    }
  }

  void _finishWith(String problem) {
    if (!mounted) return;
    setState(() {
      _pairing = false;
      _problem = problem;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Pair your phone')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.notice case final notice?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(notice)),
              ),
            const Text(
              'Only your own phone can talk to your Buddy. To pair this one, run npm run pair '
              'in the backend folder on your laptop, then scan the QR code it shows.',
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _pairing ? null : _scan, child: const Text('Scan the QR code')),
            const SizedBox(height: 32),
            Semantics(
              header: true,
              child: Text('Or type it', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _address,
              keyboardType: TextInputType.url,
              autocorrect: false,
              enableSuggestions: false,
              decoration: InputDecoration(
                labelText: 'Laptop address',
                helperText: emulatorAllowed
                  ? 'Shown under the QR code. On the emulator, leave it as it is.'
                  : 'Shown under the QR code.',
                helperMaxLines: 4,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _code,
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(labelText: 'Code', border: OutlineInputBorder()),
              onSubmitted: (_) {
                if (!_pairing) _pairWithTypedCode();
              },
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: _pairing ? null : _pairWithTypedCode, child: const Text('Pair')),
            if (_pairing)
              Semantics(
                container: true,
                liveRegion: true,
                child: const Padding(padding: EdgeInsets.only(top: 12), child: Text('Pairing…')),
              ),
            if (_problem case final problem?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(problem, style: TextStyle(color: theme.colorScheme.error)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The camera, on a screen of its own. Closes with the first QR code it sees.
class _ScanScreen extends StatefulWidget {
  const _ScanScreen({required this.scannerBuilder});

  final QrScannerBuilder scannerBuilder;

  @override
  State<_ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<_ScanScreen> {
  bool _seen = false;

  void _onScanned(String text) {
    // The camera keeps reporting the same code until the screen has closed.
    if (_seen) return;
    _seen = true;
    Navigator.of(context).pop(text);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(leading: const BackButton(), title: const Text('Scan the QR code')),
      body: Semantics(
        container: true,
        label: 'Camera view. Point it at the QR code on your laptop. '
            "If you can't, go back and type the code instead.",
        child: widget.scannerBuilder(context, _onScanned),
      ),
    );
  }
}
