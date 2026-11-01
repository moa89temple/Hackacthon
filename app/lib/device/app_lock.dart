import 'package:local_auth/local_auth.dart';

enum UnlockResult {
  unlocked,

  /// The Student closed the prompt, or the phone did.
  cancelled,

  /// This phone has no fingerprint, face or screen lock, so nothing can prove who's holding it.
  noScreenLock,
  failed,
}

abstract interface class AppLock {
  /// Asks for the fingerprint or face, with the phone's own screen lock as the fallback.
  Future<UnlockResult> unlock();
}

class DeviceAppLock implements AppLock {
  final _auth = LocalAuthentication();

  @override
  Future<UnlockResult> unlock() async {
    try {
      final passed = await _auth.authenticate(localizedReason: 'Open Buddy');
      return passed ? UnlockResult.unlocked : UnlockResult.failed;
    } on LocalAuthException catch (error) {
      return switch (error.code) {
        LocalAuthExceptionCode.userCanceled ||
        LocalAuthExceptionCode.systemCanceled ||
        LocalAuthExceptionCode.timeout ||
        LocalAuthExceptionCode.authInProgress ||
        LocalAuthExceptionCode.userRequestedFallback =>
          UnlockResult.cancelled,
        LocalAuthExceptionCode.noCredentialsSet => UnlockResult.noScreenLock,
        _ => UnlockResult.failed,
      };
    } on Exception {
      return UnlockResult.failed;
    }
  }
}
