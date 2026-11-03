import 'package:flutter/foundation.dart';

import 'spending_backend.dart';

/// Lives as long as the app.
class SpendingController extends ChangeNotifier {
  SpendingController(this._backend);

  final SpendingBackend _backend;
  bool _disposed = false;

  /// Null until the first load has answered, because the app mustn't claim an amount it hasn't heard.
  SpendingSummary? summary;
  bool couldNotLoad = false;

  Future<void> load() async {
    couldNotLoad = false;
    _changed();
    try {
      summary = await _backend.loadSpending();
    } on Exception {
      couldNotLoad = summary == null;
    }
    _changed();
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
