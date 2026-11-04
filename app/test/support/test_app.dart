import 'dart:async';

import 'package:buddy/app.dart';
import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/briefings/phone_notifications.dart';
import 'package:buddy/chat/crisis_card.dart';
import 'package:buddy/chat/outlook.dart';
import 'package:buddy/device/app_lock.dart';
import 'package:buddy/device/device_store.dart';
import 'package:buddy/device/pairing_details.dart';
import 'package:buddy/device/qr_scanner.dart';
import 'package:buddy/takeover/live_view.dart';
import 'package:buddy/widgets/buddy_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_backend.dart';
import 'fake_briefings.dart';

final canvasTakeover = Takeover(
  site: 'canvas',
  siteName: 'Canvas',
  liveViewUrl: Uri.parse('http://backend.test/takeover/live/token/takeover.html'),
);

/// The way the backend describes Canvas. The words on the card here are made up for these tests.
Connection canvasConnection({
  String id = 'canvas',
  String name = 'Canvas',
  bool on = false,
  bool logsIn = true,
  bool needsLogin = false,
  bool loginNotDeletedYet = false,
  String? problem,
  DateTime? lastReadAt,
}) =>
    Connection(
      id: id,
      name: name,
      on: on,
      lastReadAt: lastReadAt,
      lastReadProblem: problem,
      logsIn: logsIn,
      needsLogin: needsLogin,
      loginNotDeletedYet: loginNotDeletedYet,
      card: const ReadPermissionCardContent(
        reads: ['Your courses this term.'],
        notes: ['You log in yourself through a Takeover.'],
        warning: "Canvas's own rules forbid this.",
      ),
    );

final testDevice = PairedDevice(address: Uri.parse('https://laptop.test'), key: 'test-device-key');

class FakeDeviceStore implements DeviceStore {
  FakeDeviceStore([this.device]);

  PairedDevice? device;

  @override
  Future<PairedDevice?> read() async => device;

  @override
  Future<void> save(PairedDevice device) async => this.device = device;

  @override
  Future<void> forget() async => device = null;
}

/// Says yes unless a test queues other answers, or holds the prompt open with [hold].
class FakeAppLock implements AppLock {
  FakeAppLock([List<UnlockResult>? answers]) : answers = answers ?? [];

  final List<UnlockResult> answers;
  int prompts = 0;
  Completer<UnlockResult>? hold;

  @override
  Future<UnlockResult> unlock() async {
    prompts++;
    if (hold case final hold?) return hold.future;
    return answers.isEmpty ? UnlockResult.unlocked : answers.removeAt(0);
  }
}

class FakeBackendAccess implements BackendAccess {
  FakeBackendAccess(this.backend);

  final BuddyBackend backend;
  final List<PairingDetails> pairings = [];
  Object? pairError;
  void Function()? keyRefused;

  @override
  Future<PairedDevice> pair(PairingDetails details) async {
    pairings.add(details);
    if (pairError case final error?) throw error;
    return PairedDevice(address: details.address, key: 'new-device-key');
  }

  @override
  BuddyBackend open(PairedDevice device, {required void Function() onKeyRefused}) {
    keyRefused = onKeyRefused;
    return backend;
  }
}

/// A real WebView can't run in a widget test, so this shows which address it would open.
Widget stubLiveView(Uri url, Map<String, String> headers) => Text('live view of $url');

Widget noScanner(BuildContext context, ValueChanged<String> onScanned) => const Text('camera');

/// A widget test can't open the phone app, so by default this pretends it did.
Future<bool> pretendToOpenPhone(Uri address) async => true;

/// A widget test can't open Outlook either.
Future<bool> pretendToOpenDraft(OutlookEmail email) async => true;

BuddyApp testApp({
  required DeviceStore store,
  required AppLock lock,
  required BackendAccess access,
  LiveViewBuilder liveViewBuilder = stubLiveView,
  QrScannerBuilder scannerBuilder = noScanner,
  PhoneOpener openPhone = pretendToOpenPhone,
  DraftOpener openDraft = pretendToOpenDraft,
  PhoneNotifications? phoneNotifications,
}) =>
    BuddyApp(
      deviceStore: store,
      appLock: lock,
      access: access,
      liveViewBuilder: liveViewBuilder,
      qrScannerBuilder: scannerBuilder,
      openPhone: openPhone,
      openDraft: openDraft,
      phoneNotifications: phoneNotifications ?? FakePhoneNotifications(),
    );

ChatMessage student(String text) => ChatMessage(isFromBuddy: false, text: text);
ChatMessage buddy(String text) => ChatMessage(isFromBuddy: true, text: text);

Future<void> sendMessage(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
  await tester.tap(find.byTooltip('Send'));
  await tester.pump();
}

/// Enough frames for the app to read the device, ask for the unlock and load its first screen.
Future<void> settleApp(WidgetTester tester) async {
  for (var frame = 0; frame < 5; frame++) {
    await tester.pump();
  }
}

/// Goes to a tab by its label in the bar along the bottom, which the same word elsewhere on the screen can't be mistaken for.
Future<void> goToTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byType(BuddyNavBar), matching: find.text(label)));
  await tester.pump();
}

/// Opens one of the You tab's rows, from wherever the Student is.
Future<void> openYouRow(WidgetTester tester, String row) async {
  await goToTab(tester, 'You');
  await settleApp(tester);
  await tester.dragUntilVisible(find.text(row), find.byType(ListView).last, const Offset(0, -200));
  await tester.pump();
  await tester.ensureVisible(find.text(row));
  await tester.pump();
  await tester.tap(find.text(row));
  await settleRoute(tester);
}

/// Lets a new screen arrive. It can't wait for everything to stop, because the writing dots don't while a reply is due.
Future<void> settleRoute(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
}

/// Taps a row that opens another screen, and lets that screen arrive.
Future<void> openRow(WidgetTester tester, String row) async {
  await tester.ensureVisible(find.text(row).first);
  await tester.pump();
  await tester.tap(find.text(row).first);
  await tester.pumpAndSettle();
}

/// The app on a phone that's already paired, opened with the fingerprint. It's on the conversation unless [onToday],
/// because most of what's tested happens there. Left to itself the app starts on Today, or on the conversation for a
/// Student who hasn't written anything yet.
Future<void> openUnlockedApp(
  WidgetTester tester,
  FakeBackend backend, {
  PhoneOpener openPhone = pretendToOpenPhone,
  DraftOpener openDraft = pretendToOpenDraft,
  PhoneNotifications? phoneNotifications,
  bool leftToItself = false,
}) async {
  await tester.pumpWidget(
    testApp(
      store: FakeDeviceStore(testDevice),
      lock: FakeAppLock(),
      access: FakeBackendAccess(backend),
      openPhone: openPhone,
      openDraft: openDraft,
      phoneNotifications: phoneNotifications,
    ),
  );
  await settleApp(tester);
  if (!leftToItself && find.text('Your Temple guide').evaluate().isEmpty) {
    await goToTab(tester, 'Buddy');
    await settleApp(tester);
  }
}

/// Flutter draws no frames once the app is hidden, so a frame only comes after inactive.
Future<void> goToBackground(WidgetTester tester) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  await tester.pump();
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
  await settleApp(tester);
}

Future<void> comeBack(WidgetTester tester) async {
  for (final state in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
    tester.binding.handleAppLifecycleStateChanged(state);
  }
  await settleApp(tester);
}
