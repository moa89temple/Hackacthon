import 'package:flutter/foundation.dart';

import 'sending_backend.dart';

const _couldNotReach = "The app couldn't reach Buddy, so nothing changed. Check that the backend is running, then try again.";

/// Lives as long as the app. Each change waits for the backend, so what's shown is always what's saved.
class SendingController extends ChangeNotifier {
  SendingController(this._backend, {required this.onChanged});

  final SendingBackend _backend;

  /// A change stops cards made before it, and the conversation should show that.
  final VoidCallback onChanged;
  bool _disposed = false;

  /// Null until the first load has answered, because the app mustn't claim a mode it hasn't heard.
  SendingSettings? settings;
  bool couldNotLoad = false;

  /// Why the latest change didn't happen.
  String? problem;
  bool isChanging = false;

  Future<void> load() async {
    couldNotLoad = false;
    _changed();
    try {
      settings = await _backend.loadSending();
    } on Exception {
      couldNotLoad = settings == null;
    }
    _changed();
  }

  Future<void> _change(Future<SendingSettings> Function() change) async {
    if (isChanging) return;
    isChanging = true;
    problem = null;
    _changed();
    try {
      settings = await change();
      onChanged();
    } on SendingRefused catch (refused) {
      problem = refused.message;
    } on Exception {
      problem = _couldNotReach;
    }
    isChanging = false;
    _changed();
  }

  Future<void> switchToLive() => _change(_backend.switchToLive);

  Future<void> switchToPractice() => _change(_backend.switchToPractice);

  Future<void> saveOwnAddress(String address) => _change(() => _backend.saveOwnAddress(address));

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
