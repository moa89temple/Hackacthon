import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/device/app_lock.dart';
import 'package:buddy/device/pairing_details.dart';
import 'package:buddy/device/qr_scanner.dart';
import 'package:buddy/widgets/buddy_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

/// A scanner that shows a button for each QR code a test wants to hold up to the camera.
QrScannerBuilder scannerSeeing(String qr) => (context, onScanned) => TextButton(
      onPressed: () => onScanned(qr),
      child: const Text('see QR code'),
    );

const laptopQr = 'buddy://pair?address=https%3A%2F%2Flaptop.tail1234.ts.net&code=ABCD-EFGH';

void main() {
  group('reading the QR code', () {
    test('finds the address and code in what the backend puts in it', () {
      // The backend's own test makes this same text. See backend/test/devices.test.ts.
      final details = PairingDetails.fromQr(laptopQr)!;

      expect(details.address, Uri.parse('https://laptop.tail1234.ts.net'));
      expect(details.code, 'ABCD-EFGH');
    });

    for (final (name, qr) in [
      ('a web page', 'https://example.com/'),
      ('plain text', 'hello'),
      ('another app', 'other://pair?address=https%3A%2F%2Flaptop.test&code=ABCD-EFGH'),
      ('no code', 'buddy://pair?address=https%3A%2F%2Flaptop.test'),
      ('no address', 'buddy://pair?code=ABCD-EFGH'),
      ('an unencrypted address', 'buddy://pair?address=http%3A%2F%2Flaptop.test&code=ABCD-EFGH'),
    ]) {
      test('refuses $name', () {
        expect(PairingDetails.fromQr(qr), isNull);
      });
    }
  });

  group('the backend address', () {
    test('must be encrypted, so a key never crosses a network in the clear', () {
      expect(parseBackendAddress('http://laptop.tail1234.ts.net'), isNull);
      expect(parseBackendAddress('http://100.64.0.1:8787'), isNull);
      expect(parseBackendAddress('ftp://laptop.test'), isNull);
      expect(parseBackendAddress(''), isNull);
    });

    test('can be plain on the emulator, which only reaches this laptop', () {
      expect(parseBackendAddress('http://10.0.2.2:8787'), Uri.parse('http://10.0.2.2:8787'));
    });

    test('can not be plain in a release build, which is what a real phone runs', () {
      expect(parseBackendAddress('http://10.0.2.2:8787', allowEmulator: false), isNull);
      expect(parseBackendAddress('https://laptop.test', allowEmulator: false), Uri.parse('https://laptop.test'));
    });

    test('is forgiving about how it is typed', () {
      expect(parseBackendAddress(' laptop.test/ '), Uri.parse('https://laptop.test'));
      expect(parseBackendAddress('https://laptop.test/some/page'), Uri.parse('https://laptop.test'));
    });
  });

  group('asking the backend to pair', () {
    final details = PairingDetails(address: Uri.parse('https://laptop.test'), code: 'ABCD-EFGH');

    test('sends the code and keeps the key it gets back', () async {
      late http.Request sent;
      final access = HttpBackendAccess(
        client: MockClient((request) async {
          sent = request;
          return http.Response(jsonEncode({'deviceKey': 'the-key'}), 200);
        }),
      );

      final device = await access.pair(details);

      expect(sent.method, 'POST');
      expect(sent.url, Uri.parse('https://laptop.test/devices/pair'));
      expect(jsonDecode(sent.body), {'code': 'ABCD-EFGH'});
      expect(device.key, 'the-key');
      expect(device.address, details.address);
    });

    test('says when the code was refused', () {
      final access = HttpBackendAccess(
        client: MockClient((request) async => http.Response('{"error":"no"}', 401)),
      );

      expect(access.pair(details), throwsA(isA<PairingRefused>()));
    });

    test('tells a refusal apart from any other failure', () {
      final access = HttpBackendAccess(
        client: MockClient((request) async => http.Response('nope', 500)),
      );

      expect(access.pair(details), throwsA(isA<BackendException>()));
    });
  });

  group('the pairing screen', () {
    late FakeDeviceStore store;
    late FakeAppLock lock;
    late FakeBackend backend;
    late FakeBackendAccess access;

    setUp(() {
      store = FakeDeviceStore();
      lock = FakeAppLock();
      backend = FakeBackend();
      access = FakeBackendAccess(backend);
    });

    Future<void> open(WidgetTester tester, {QrScannerBuilder scannerBuilder = noScanner}) async {
      await tester.pumpWidget(
        testApp(store: store, lock: lock, access: access, scannerBuilder: scannerBuilder),
      );
      await settleApp(tester);
    }

    Future<void> typeCode(WidgetTester tester, String code) async {
      await tester.enterText(find.widgetWithText(TextField, 'Code'), code);
      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Pair'));
      await tester.pump();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Pair'));
      await settleApp(tester);
    }

    Future<void> scan(WidgetTester tester) async {
      await tester.tap(find.text('Scan the QR code'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('see QR code'));
      await tester.pumpAndSettle();
      await settleApp(tester);
    }

    testWidgets('comes first on a phone that has not paired, and never asks to unlock', (tester) async {
      await open(tester);

      expect(find.text('Scan the QR code'), findsOneWidget);
      expect(find.byType(BuddyNavBar), findsNothing);
      expect(lock.prompts, 0);
      expect(backend.historyLoads, 0);
    });

    testWidgets('pairs with a typed code on the emulator without typing an address', (tester) async {
      await open(tester);

      await typeCode(tester, 'abcd-efgh');

      expect(access.pairings.single.address, Uri.parse('http://10.0.2.2:8787'));
      expect(access.pairings.single.code, 'abcd-efgh');
    });

    testWidgets('pairs with a typed address on a real phone', (tester) async {
      await open(tester);

      await tester.enterText(find.widgetWithText(TextField, 'Laptop address'), 'https://laptop.test');
      await typeCode(tester, 'ABCD-EFGH');

      expect(access.pairings.single.address, Uri.parse('https://laptop.test'));
    });

    testWidgets('saves the key, then asks for the fingerprint before opening Buddy', (tester) async {
      lock.answers.add(UnlockResult.cancelled);
      await open(tester);

      await typeCode(tester, 'ABCD-EFGH');

      expect(store.device!.key, 'new-device-key');
      expect(lock.prompts, 1);
      expect(find.byType(BuddyNavBar), findsNothing);
      expect(backend.historyLoads, 0);

      await tester.tap(find.text('Unlock'));
      await settleApp(tester);

      expect(find.byType(BuddyNavBar), findsOneWidget);
      expect(backend.historyLoads, 1);
    });

    testWidgets('pairs from a scanned QR code', (tester) async {
      await open(tester, scannerBuilder: scannerSeeing(laptopQr));

      await scan(tester);

      expect(access.pairings.single.address, Uri.parse('https://laptop.tail1234.ts.net'));
      expect(access.pairings.single.code, 'ABCD-EFGH');
      expect(find.byType(BuddyNavBar), findsOneWidget);
    });

    testWidgets('pairs only once when the camera sees the code again and again', (tester) async {
      await open(
        tester,
        scannerBuilder: (context, onScanned) => TextButton(
          onPressed: () {
            onScanned(laptopQr);
            onScanned(laptopQr);
          },
          child: const Text('see QR code'),
        ),
      );

      await scan(tester);

      expect(access.pairings, hasLength(1));
    });

    testWidgets('explains when a scanned QR code is not a pairing code', (tester) async {
      await open(tester, scannerBuilder: scannerSeeing('https://example.com/'));

      await scan(tester);

      expect(access.pairings, isEmpty);
      expect(find.textContaining("isn't a Buddy pairing code"), findsOneWidget);
    });

    testWidgets('explains a refused code, and how to get a new one', (tester) async {
      access.pairError = const PairingRefused();
      await open(tester);

      await typeCode(tester, 'ABCD-EFGH');

      expect(find.textContaining('npm run pair'), findsWidgets);
      expect(find.textContaining("didn't work"), findsOneWidget);
      expect(store.device, isNull);
      expect(find.byType(BuddyNavBar), findsNothing);
    });

    testWidgets('explains when the laptop cannot be reached, then allows a retry', (tester) async {
      access.pairError = const BackendException('offline');
      await open(tester);

      await typeCode(tester, 'ABCD-EFGH');
      expect(find.textContaining("couldn't reach your laptop"), findsOneWidget);

      access.pairError = null;
      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Pair'));
      await tester.pump();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Pair'));
      await settleApp(tester);

      expect(find.byType(BuddyNavBar), findsOneWidget);
    });

    testWidgets('refuses an unencrypted address without sending the code', (tester) async {
      await open(tester);

      await tester.enterText(find.widgetWithText(TextField, 'Laptop address'), 'http://laptop.test');
      await typeCode(tester, 'ABCD-EFGH');

      expect(access.pairings, isEmpty);
      expect(find.textContaining('https://'), findsOneWidget);
    });

    testWidgets('does not send an empty code', (tester) async {
      await open(tester);

      await typeCode(tester, '   ');

      expect(access.pairings, isEmpty);
    });
  });

  group('a key the backend no longer accepts', () {
    testWidgets('sends the phone back to pairing and forgets the key', (tester) async {
      final store = FakeDeviceStore(testDevice);
      final access = FakeBackendAccess(FakeBackend());
      await tester.pumpWidget(testApp(store: store, lock: FakeAppLock(), access: access));
      await settleApp(tester);
      expect(find.byType(BuddyNavBar), findsOneWidget);

      access.keyRefused!();
      await settleApp(tester);

      expect(store.device, isNull);
      expect(find.byType(BuddyNavBar), findsNothing);
      expect(find.text('Scan the QR code'), findsOneWidget);
      final notice = find.ancestor(
        of: find.textContaining('no longer paired'),
        matching: find.byWidgetPredicate((widget) => widget is Semantics && widget.properties.liveRegion == true),
      );
      expect(notice, findsOneWidget);
    });
  });

  group('accessibility', () {
    Future<void> open(WidgetTester tester) async {
      await tester.pumpWidget(
        testApp(store: FakeDeviceStore(), lock: FakeAppLock(), access: FakeBackendAccess(FakeBackend())),
      );
      await settleApp(tester);
    }

    testWidgets('meets the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await open(tester);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('a screen reader hears what went wrong', (tester) async {
      final handle = tester.ensureSemantics();
      final access = FakeBackendAccess(FakeBackend())..pairError = const PairingRefused();
      await tester.pumpWidget(testApp(store: FakeDeviceStore(), lock: FakeAppLock(), access: access));
      await settleApp(tester);

      await tester.enterText(find.widgetWithText(TextField, 'Code'), 'ABCD-EFGH');
      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Pair'));
      await tester.pump();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Pair'));
      await settleApp(tester);

      final note = find.ancestor(
        of: find.textContaining("didn't work"),
        matching: find.byWidgetPredicate((widget) => widget is Semantics && widget.properties.liveRegion == true),
      );
      expect(note, findsOneWidget);
      handle.dispose();
    });

    testWidgets('fits at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      await open(tester);

      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Pair'));
      await tester.pump();
      expect(find.widgetWithText(OutlinedButton, 'Pair').hitTestable(), findsOneWidget);
    });

    testWidgets('the scanner fits at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await open(tester);

      await tester.ensureVisible(find.text('Scan the QR code'));
      await tester.pump();
      await tester.tap(find.text('Scan the QR code'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('Or type it'), findsOneWidget);
    });

    testWidgets('the scanner explains the camera to a screen reader and can be left', (tester) async {
      final handle = tester.ensureSemantics();
      await open(tester);

      await tester.tap(find.text('Scan the QR code'));
      await tester.pumpAndSettle();

      expect(find.bySemanticsLabel(RegExp('Camera view')), findsOneWidget);
      expect(find.byType(BackButton), findsOneWidget);
      handle.dispose();
    });
  });
}
