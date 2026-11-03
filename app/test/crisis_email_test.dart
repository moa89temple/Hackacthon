import 'dart:async';
import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/crisis_card.dart';
import 'package:buddy/sending/sending_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

// All made up, and only ever in these tests.
const ownAddress = 'student@temple.test';
const friendAddress = 'sam.madeup@example.test';

const resources = ['Call 988', 'Text 988', 'Text HOME to 741741', 'Call 911', 'Call (215) 204-7276'];
const offerTitle = 'Want Buddy to email someone? Choose who.';
const formHeading = 'Who should Buddy email for you?';

ActionCard practiceCard({int id = 9, bool canDecide = true, String status = 'waiting', String statusText = 'Waiting for your tap.', String? outcome}) => ActionCard(
      id: id,
      title: 'Send a practice email to yourself',
      shows: const [
        CardLine(label: 'Practice mode', value: 'This email will go to you, not to Sam. To send it to Sam instead, tap Switch to Live.'),
        CardLine(label: 'To', value: ownAddress),
        CardLine(label: 'In Live, this would go to', value: 'Sam <$friendAddress>'),
        CardLine(label: 'Message', value: 'Hi'),
      ],
      status: status,
      statusText: statusText,
      note: canDecide ? 'You can approve this until Tuesday.' : null,
      outcome: outcome,
      fingerprint: 'practice-print',
      canDecide: canDecide,
      isCrisisEmail: true,
      offersLive: true,
    );

ActionCard liveCard() => const ActionCard(
      id: 10,
      title: 'Send a real email from your TUmail',
      shows: [
        CardLine(label: 'Live', value: 'This really goes to Sam.'),
        CardLine(label: 'To', value: friendAddress),
      ],
      status: 'waiting',
      statusText: 'Waiting for your tap.',
      fingerprint: 'live-print',
      canDecide: true,
      isCrisisEmail: true,
    );

GuidebookItem tuttleman() => GuidebookItem(
      id: 4,
      name: 'Tuttleman Counseling Services',
      summary: 'Counseling.',
      email: 'counseling.madeup@temple.test',
      sources: [GuidebookSource(url: 'https://counseling.temple.edu/about-us/contact-us', title: 'Contact Us', lastSeenAt: DateTime.utc(2026, 11, 2, 14))],
    );

CrisisEmailOffer offer({String? whyNotYet, bool isLive = false, String? own = ownAddress, GuidebookItem? tuttleman}) =>
    CrisisEmailOffer(whyNotYet: whyNotYet, isLive: isLive, ownAddress: own, tuttleman: tuttleman);

void useOrdinaryPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> showCrisisCard(WidgetTester tester, FakeBackend backend, {PhoneOpener? openPhone}) async {
  useOrdinaryPhone(tester);
  backend.history = [student('Help'), CrisisCardItem(), buddy('I am here.')];
  await openUnlockedApp(tester, backend, openPhone: openPhone ?? pretendToOpenPhone);
}

Future<void> tapThrough(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> openForm(WidgetTester tester) => tapThrough(tester, find.text(offerTitle));

Finder field(String label) => find.widgetWithText(TextField, label);

Future<void> fillIn(WidgetTester tester, String label, String text) async {
  await tester.ensureVisible(field(label));
  await tester.pump();
  await tester.enterText(field(label), text);
  await tester.pump();
}

Finder inDialog(String text) => find.descendant(of: find.byType(AlertDialog), matching: find.text(text));

Future<void> expectEveryResourceReachable(WidgetTester tester) async {
  for (final label in resources) {
    final button = find.text(label, skipOffstage: false);
    expect(button, findsWidgets, reason: label);
    await tester.ensureVisible(button.first);
    await tester.pumpAndSettle();
    expect(find.text(label).first.hitTestable(), findsOneWidget, reason: label);
  }
}

void main() {
  group('the offer on the Crisis card', () {
    testWidgets('asks whom to email as soon as the card shows, and the form says nothing goes without Approve', (tester) async {
      await showCrisisCard(tester, FakeBackend());

      await tester.ensureVisible(find.text(offerTitle));
      await tester.pump();
      expect(find.text(offerTitle), findsOneWidget);

      await openForm(tester);

      expect(find.textContaining('a friend, a family member or Tuttleman Counseling'), findsOneWidget);
      expect(find.textContaining('Nothing goes until you tap Approve'), findsOneWidget);
    });

    testWidgets("leaves a short reply on an ordinary phone's screen, along with the whole card", (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply.add(const ReplyCrisisCard());
      await tester.pumpAndSettle();
      backend.reply.add(ReplyDone(buddy('I am here.')));
      await backend.reply.close();
      await tester.pumpAndSettle();

      expect(find.text('I am here.').hitTestable(), findsOneWidget);
      expect(find.text('Help is here, right now').hitTestable(), findsOneWidget);
      expect(find.text('Call 988').hitTestable(), findsOneWidget);
      expect(find.text(offerTitle).hitTestable(), findsOneWidget);
    });

    testWidgets('keeps the title and 988 on screen while a long reply arrives', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply.add(const ReplyCrisisCard());
      await tester.pumpAndSettle();
      for (var chunk = 0; chunk < 40; chunk++) {
        backend.reply.add(const ReplyText('I am really glad you told me. '));
        await tester.pump();
        await tester.pump();
        expect(find.text('Call 988').hitTestable(), findsOneWidget, reason: 'after chunk $chunk');
      }
      backend.reply.add(ReplyDone(buddy('I am really glad you told me. ' * 40)));
      await backend.reply.close();
      await tester.pumpAndSettle();

      expect(find.text('Help is here, right now').hitTestable(), findsOneWidget);
      expect(find.text('Call 988').hitTestable(), findsOneWidget);
    });

    testWidgets("leaves the Student where they are once they've scrolled themselves", (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');
      backend.reply.add(const ReplyCrisisCard());
      await tester.pumpAndSettle();
      for (var chunk = 0; chunk < 20; chunk++) {
        backend.reply.add(const ReplyText('I am really glad you told me. '));
        await tester.pump();
      }
      await tester.pumpAndSettle();

      await tester.drag(find.byType(ListView), const Offset(0, -400));
      await tester.pumpAndSettle();
      final scrolledTo = tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;
      backend.reply.add(const ReplyText('And more. '));
      await tester.pumpAndSettle();

      expect(tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels, scrolledTo);
      await backend.reply.close();
    });

    testWidgets('comes after every crisis Resource', (tester) async {
      await showCrisisCard(tester, FakeBackend());
      tester.view.physicalSize = const Size(412, 2400);
      await tester.pump();

      final offerAt = tester.getTopLeft(find.text(offerTitle)).dy;
      for (final label in resources) {
        expect(tester.getTopLeft(find.text(label)).dy, lessThan(offerAt), reason: label);
      }
    });

    testWidgets("doesn't wait for the backend: the Resources show while it hasn't answered", (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()..holdCrisisOffer = Completer<void>();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();

      expect(find.text('Call 988'), findsOneWidget);
      expect(find.text('Help is here, right now'), findsOneWidget);
      await expectEveryResourceReachable(tester);
      await backend.reply.close();
    });

    testWidgets('the Resources and the question stay if the backend can\'t say how things stand', (tester) async {
      final opened = <Uri>[];
      await showCrisisCard(
        tester,
        FakeBackend()..crisisOfferError = http.ClientException('no route'),
        openPhone: (uri) async {
          opened.add(uri);
          return true;
        },
      );

      await expectEveryResourceReachable(tester);
      await tester.ensureVisible(find.text(offerTitle));
      await tester.pump();
      expect(find.text(offerTitle), findsOneWidget);

      await tapThrough(tester, find.text('Call 988'));
      expect(opened, [Uri.parse('tel:988')]);
    });

    testWidgets("doesn't move the form the Student is typing in while the reply arrives", (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');
      backend.reply.add(const ReplyCrisisCard());
      await tester.pumpAndSettle();

      await openForm(tester);
      await tester.ensureVisible(field('Their email address'));
      await tester.pumpAndSettle();
      final before = tester.getTopLeft(field('Their email address')).dy;
      backend.reply.add(const ReplyText('I am really glad you told me. '));
      await tester.pumpAndSettle();
      backend.reply.add(const ReplyText('I am really glad you told me. '));
      await tester.pumpAndSettle();

      expect(field('Their email address').hitTestable(), findsOneWidget);
      expect(tester.getTopLeft(field('Their email address')).dy, lessThanOrEqualTo(before));
      await backend.reply.close();
    });

    testWidgets('a screen reader hears the offer by name, as a button', (tester) async {
      final handle = tester.ensureSemantics();
      await showCrisisCard(tester, FakeBackend());
      await tester.ensureVisible(find.text(offerTitle));
      await tester.pump();

      expect(tester.getSemantics(find.bySemanticsLabel(offerTitle)).flagsCollection.isButton, isTrue);
      handle.dispose();
    });

    testWidgets('makes no request that could send anything until the Student fills it in and taps', (tester) async {
      final backend = FakeBackend();
      await showCrisisCard(tester, backend);
      await openForm(tester);

      expect(backend.crisisEmailsAskedFor, isEmpty);
      expect(backend.approvals, isEmpty);
    });
  });

  group('when the email can\'t go out', () {
    const notConnected = "TUmail isn't connected, so an email can't go out yet. You can connect it on the You tab.";
    const loggedOut = "Buddy's Browser isn't logged in to TUmail, so an email can't go out yet. Tap Log in to TUmail on the You tab.";

    for (final (what, why) in [('TUmail is not connected', notConnected), ('the login has expired', loggedOut)]) {
      testWidgets('with $what, says so plainly, offers no form, and keeps every Resource', (tester) async {
        final opened = <Uri>[];
        await showCrisisCard(
          tester,
          FakeBackend()..crisisOffer = offer(whyNotYet: why),
          openPhone: (uri) async {
            opened.add(uri);
            return true;
          },
        );

        await tester.ensureVisible(find.textContaining("can't go out yet"));
        await tester.pump();
        expect(find.text(why), findsOneWidget);
        expect(find.text(offerTitle), findsNothing);

        await expectEveryResourceReachable(tester);
        await tapThrough(tester, find.text('Call 911'));
        expect(opened, [Uri.parse('tel:911')]);
      });

      testWidgets('with $what, a screen reader hears it on a new card, but not on an earlier one when the app opens', (tester) async {
        final handle = tester.ensureSemantics();
        useOrdinaryPhone(tester);
        final backend = FakeBackend()..crisisOffer = offer(whyNotYet: why);
        await openUnlockedApp(tester, backend);
        await sendMessage(tester, 'I want to kill myself');
        backend.reply.add(const ReplyCrisisCard());
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.textContaining("can't go out yet"));
        await tester.pump();

        expect(tester.getSemantics(find.textContaining("can't go out yet")).flagsCollection.isLiveRegion, isTrue);
        await backend.reply.close();
        handle.dispose();
      });

      testWidgets('with $what, an earlier card says nothing out loud when the app opens', (tester) async {
        final handle = tester.ensureSemantics();
        await showCrisisCard(tester, FakeBackend()..crisisOffer = offer(whyNotYet: why));
        await tester.ensureVisible(find.textContaining("can't go out yet"));
        await tester.pump();

        expect(tester.getSemantics(find.textContaining("can't go out yet")).flagsCollection.isLiveRegion, isFalse);
        handle.dispose();
      });
    }

    testWidgets('can look again once the Student has fixed it', (tester) async {
      final backend = FakeBackend()..crisisOffer = offer(whyNotYet: notConnected);
      await showCrisisCard(tester, backend);

      backend.crisisOffer = offer();
      await tapThrough(tester, find.text('Check again'));

      expect(find.textContaining("can't go out yet"), findsNothing);
      expect(find.text(offerTitle), findsOneWidget);
    });

    testWidgets("if it's only found at the tap, says why, makes no card, and keeps every Resource", (tester) async {
      final backend = FakeBackend()..crisisCardRefusal = loggedOut;
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);

      await tapThrough(tester, find.text('Show me the email'));

      expect(find.text(loggedOut), findsOneWidget);
      expect(find.text('Approve'), findsNothing);
      await expectEveryResourceReachable(tester);
    });

    testWidgets("if Buddy can't be reached, says so, and keeps every Resource", (tester) async {
      final backend = FakeBackend()..crisisCardError = http.ClientException('no route');
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);

      await tapThrough(tester, find.text('Show me the email'));

      expect(find.textContaining("couldn't reach Buddy"), findsOneWidget);
      await expectEveryResourceReachable(tester);
    });

    testWidgets('if the login goes at the Approve tap, the card says nothing was sent, and the Resources stay', (tester) async {
      const outcome = "Buddy's Browser isn't logged in to TUmail. Tap Log in to TUmail on the You tab, then ask for a new card. Nothing was sent.";
      final backend = FakeBackend()
        ..crisisCardToMake = practiceCard()
        ..cardAfterApprove = practiceCard(status: 'not_run', statusText: "Buddy didn't do this.", canDecide: false, outcome: outcome);
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);
      await tapThrough(tester, find.text('Show me the email'));

      await tapThrough(tester, find.text('Approve'));

      expect(find.text(outcome), findsOneWidget);
      await expectEveryResourceReachable(tester);
    });
  });

  group('writing the email', () {
    testWidgets('starts with words the Student can change, ending with the line about Buddy', (tester) async {
      await showCrisisCard(tester, FakeBackend());
      await openForm(tester);

      final message = tester.widget<TextField>(field('Message')).controller!.text;
      expect(message, contains("I'm having a really hard time right now"));
      expect(message, endsWith('Drafted with help from Buddy, an AI assistant'));
      expect(tester.widget<TextField>(field('Subject')).controller!.text, isNotEmpty);
    });

    testWidgets('sends what the Student wrote, and shows the card without approving it', (tester) async {
      final backend = FakeBackend()..crisisCardToMake = practiceCard();
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their name (you can leave this out)', 'Sam');
      await fillIn(tester, 'Their email address', friendAddress);
      await fillIn(tester, 'Subject', 'Please call');
      await fillIn(tester, 'Message', 'Can you call me?');

      await tapThrough(tester, find.text('Show me the email'));

      expect(backend.crisisEmailsAskedFor.single, (name: 'Sam', address: friendAddress, subject: 'Please call', body: 'Can you call me?'));
      expect(backend.approvals, isEmpty);
      expect(find.text('Send a practice email to yourself'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
    });

    testWidgets('asks for an address rather than asking the backend without one', (tester) async {
      final backend = FakeBackend();
      await showCrisisCard(tester, backend);
      await openForm(tester);

      await tapThrough(tester, find.text('Show me the email'));

      expect(backend.crisisEmailsAskedFor, isEmpty);
      expect(find.textContaining('Write the email address'), findsOneWidget);
    });

    testWidgets('the email goes only with the Approve tap, which sends what the card showed', (tester) async {
      final backend = FakeBackend()
        ..crisisCardToMake = practiceCard()
        ..cardAfterApprove = practiceCard(status: 'done', statusText: 'Done.', canDecide: false);
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);
      await tapThrough(tester, find.text('Show me the email'));
      expect(backend.approvals, isEmpty);

      await tapThrough(tester, find.widgetWithText(FilledButton, 'Approve'));

      expect(backend.approvals, [(9, 'practice-print')]);
      expect(find.text('Done.'), findsOneWidget);
    });

    testWidgets('a typed yes approves nothing', (tester) async {
      final backend = FakeBackend()..crisisCardToMake = practiceCard();
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);
      await tapThrough(tester, find.text('Show me the email'));

      await tester.enterText(field('Message Buddy'), 'yes, send it');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();
      backend.reply.add(ReplyDone(buddy('Tap Approve on the card.')));
      await backend.reply.close();
      await tester.pumpAndSettle();

      expect(backend.approvals, isEmpty);
    });

    testWidgets('what the Student wrote survives another message in the chat', (tester) async {
      final backend = FakeBackend();
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);

      await tester.enterText(field('Message Buddy'), 'Are you there?');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();
      backend.reply.add(ReplyDone(buddy('Yes, I am here.')));
      await backend.reply.close();
      await tester.pumpAndSettle();

      await tester.ensureVisible(field('Their email address'));
      await tester.pump();
      expect(tester.widget<TextField>(field('Their email address')).controller!.text, friendAddress);
    });
  });

  group('Tuttleman Counseling', () {
    testWidgets("fills in the Guidebook's address, and shows its Source", (tester) async {
      final opened = <Uri>[];
      await showCrisisCard(
        tester,
        FakeBackend()..crisisOffer = offer(tuttleman: tuttleman()),
        openPhone: (uri) async {
          opened.add(uri);
          return true;
        },
      );
      await openForm(tester);

      await tapThrough(tester, find.text('Email Tuttleman Counseling Services'));

      expect(tester.widget<TextField>(field('Their email address')).controller!.text, 'counseling.madeup@temple.test');
      expect(tester.widget<TextField>(field('Their name (you can leave this out)')).controller!.text, 'Tuttleman Counseling Services');

      await tapThrough(tester, find.text('Source: Contact Us'));
      expect(opened, [Uri.parse('https://counseling.temple.edu/about-us/contact-us')]);
    });

    testWidgets("says so when the Guidebook has no address, and doesn't make one up", (tester) async {
      await showCrisisCard(tester, FakeBackend());
      await openForm(tester);

      expect(find.text('Email Tuttleman Counseling Services'), findsNothing);
      expect(find.textContaining("Buddy doesn't have an email address for Tuttleman Counseling"), findsOneWidget);
      expect(tester.widget<TextField>(field('Their email address')).controller!.text, isEmpty);
    });
  });

  group('Practice mode', () {
    testWidgets('the form says plainly the email will go to the Student', (tester) async {
      await showCrisisCard(tester, FakeBackend());
      await openForm(tester);

      expect(find.textContaining('Practice mode is on, so this email will go to you at $ownAddress'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Switch to Live'), findsOneWidget);
    });

    testWidgets('with no address of the Student\'s, the form says that too, and offers Live', (tester) async {
      await showCrisisCard(tester, FakeBackend()..crisisOffer = offer(own: null));
      await openForm(tester);

      expect(find.textContaining("Buddy doesn't know your TUmail address yet"), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Switch to Live'), findsOneWidget);
    });

    testWidgets('in Live the form says who it goes to, and offers no switch', (tester) async {
      await showCrisisCard(tester, FakeBackend()..crisisOffer = offer(isLive: true));
      await openForm(tester);

      expect(find.textContaining('Live is on'), findsOneWidget);
      expect(find.text('Switch to Live'), findsNothing);
    });

    testWidgets('the form can switch to Live, after asking', (tester) async {
      final backend = FakeBackend();
      await showCrisisCard(tester, backend);
      await openForm(tester);

      await tapThrough(tester, find.widgetWithText(OutlinedButton, 'Switch to Live'));
      await tapThrough(tester, inDialog('Stay in Practice mode'));
      expect(backend.modesAskedFor, isEmpty);

      backend.crisisOffer = offer(isLive: true);
      await tapThrough(tester, find.widgetWithText(OutlinedButton, 'Switch to Live'));
      await tapThrough(tester, inDialog('Switch to Live'));

      expect(backend.modesAskedFor, ['live']);
      expect(find.textContaining('Live is on'), findsOneWidget);
      expect(backend.approvals, isEmpty);
    });

    Future<void> showPracticeCard(WidgetTester tester, FakeBackend backend) async {
      backend.crisisCardToMake = practiceCard();
      await showCrisisCard(tester, backend);
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);
      await tapThrough(tester, find.text('Show me the email'));
    }

    Finder onActionCard(String text) => find.descendant(of: find.byType(Card), matching: find.widgetWithText(OutlinedButton, text));

    testWidgets('the Action card says the email goes to the Student, and offers Live', (tester) async {
      await showPracticeCard(tester, FakeBackend());

      expect(find.textContaining('This email will go to you, not to Sam'), findsOneWidget);
      expect(onActionCard('Switch to Live'), findsOneWidget);
    });

    testWidgets('staying in Practice mode changes nothing', (tester) async {
      final backend = FakeBackend();
      await showPracticeCard(tester, backend);

      await tapThrough(tester, onActionCard('Switch to Live'));
      await tapThrough(tester, inDialog('Stay in Practice mode'));

      expect(backend.crisisCardsSwitched, isEmpty);
      expect(find.text('Send a practice email to yourself'), findsOneWidget);
    });

    testWidgets('switching makes a new card that still needs its own Approve, and sends nothing', (tester) async {
      final backend = FakeBackend()
        ..cardAfterLive = liveCard()
        ..cardWhenChecked = practiceCard(status: 'invalid', statusText: 'This card no longer matches what you were shown, so it no longer works.', canDecide: false);
      await showPracticeCard(tester, backend);

      await tapThrough(tester, onActionCard('Switch to Live'));
      await tapThrough(tester, inDialog('Switch to Live'));

      expect(backend.crisisCardsSwitched, [9]);
      expect(backend.approvals, isEmpty);
      expect(find.text('Send a real email from your TUmail'), findsOneWidget);
      expect(find.text(friendAddress), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      expect(onActionCard('Switch to Live'), findsNothing);
    });

    testWidgets('the You tab shows Live after switching on the card', (tester) async {
      final backend = FakeBackend()
        ..sending = const SendingSettings(isLive: false, ownAddress: ownAddress)
        ..cardAfterLive = liveCard()
        ..cardWhenChecked = practiceCard(status: 'invalid', statusText: 'No longer works.', canDecide: false);
      await showPracticeCard(tester, backend);

      await tapThrough(tester, onActionCard('Switch to Live'));
      await tapThrough(tester, inDialog('Switch to Live'));
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
      await settleApp(tester);

      expect(find.textContaining('Live is on', skipOffstage: false), findsOneWidget);
    });

    testWidgets('says why when the new card can\'t be made', (tester) async {
      const why = "You've switched to Live. Buddy's Browser isn't logged in to TUmail, so this email can't go out yet.";
      final backend = FakeBackend()
        ..crisisLiveRefusal = why
        ..cardWhenChecked = practiceCard(status: 'invalid', statusText: 'No longer works.', canDecide: false);
      await showPracticeCard(tester, backend);

      await tapThrough(tester, onActionCard('Switch to Live'));
      await tapThrough(tester, inDialog('Switch to Live'));

      expect(find.text(why), findsOneWidget);
      await expectEveryResourceReachable(tester);
    });

    testWidgets("an ordinary Draft's card offers no switch", (tester) async {
      final backend = FakeBackend();
      useOrdinaryPhone(tester);
      backend.history = [
        student('Help'),
        ActionCardItem(
          const ActionCard(
            id: 3,
            title: 'Send a practice email to yourself',
            shows: [CardLine(label: 'Practice mode', value: 'This goes to you, not to the Advising Office.')],
            status: 'waiting',
            statusText: 'Waiting for your tap.',
            fingerprint: 'print',
            canDecide: true,
          ),
        ),
      ];
      await openUnlockedApp(tester, backend);

      expect(find.text('Switch to Live'), findsNothing);
    });
  });

  group('next to the Action card', () {
    testWidgets('988 is one tap away, because the Crisis card may have scrolled out of view', (tester) async {
      final opened = <Uri>[];
      final backend = FakeBackend()..crisisCardToMake = practiceCard();
      await showCrisisCard(tester, backend, openPhone: (uri) async {
        opened.add(uri);
        return true;
      });
      await openForm(tester);
      await fillIn(tester, 'Their email address', friendAddress);
      await tapThrough(tester, find.text('Show me the email'));

      await tapThrough(tester, find.descendant(of: find.byType(Card), matching: find.text('Call 988')));

      expect(opened, [Uri.parse('tel:988')]);
      expect(backend.approvals, isEmpty);
    });
  });

  group('accessibility', () {
    Future<void> showFormOnScreen(WidgetTester tester, FakeBackend backend) async {
      await showCrisisCard(tester, backend);
      await openForm(tester);
    }

    testWidgets('the offer has a heading, and each field and button a name', (tester) async {
      final handle = tester.ensureSemantics();
      await showFormOnScreen(tester, FakeBackend());

      await tester.ensureVisible(find.text(formHeading));
      await tester.pump();
      expect(tester.getSemantics(find.text(formHeading)).flagsCollection.isHeader, isTrue);
      for (final label in ['Their name (you can leave this out)', 'Their email address', 'Subject', 'Message']) {
        await tester.ensureVisible(field(label));
        await tester.pump();
        final node = find.bySemanticsLabel(RegExp('^${RegExp.escape(label)}\$'));
        expect(node, findsOneWidget, reason: label);
        expect(tester.getSemantics(node).flagsCollection.isTextField, isTrue, reason: label);
      }
      await tester.ensureVisible(find.text('Show me the email'));
      await tester.pump();
      expect(find.bySemanticsLabel('Show me the email'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the Crisis card is still announced for what it is, and a refusal is read out', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..crisisCardRefusal = 'That does not look like one email address.';
      await showFormOnScreen(tester, backend);
      await fillIn(tester, 'Their email address', 'nope');

      await tapThrough(tester, find.text('Show me the email'));

      expect(tester.getSemantics(find.text('That does not look like one email address.')).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('the card it makes is read out, and its buttons say what they are for', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..crisisCardToMake = practiceCard();
      await showFormOnScreen(tester, backend);
      await fillIn(tester, 'Their email address', friendAddress);

      await tapThrough(tester, find.text('Show me the email'));

      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('^Action card: Send a practice email')));
      expect(node.flagsCollection.isLiveRegion, isTrue);
      expect(node.label, contains('This email will go to you, not to Sam'));
      expect(find.bySemanticsLabel('Switch to Live: Send a practice email to yourself'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the form and the Action card meet the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..crisisCardToMake = practiceCard()
        ..crisisOffer = offer(tuttleman: tuttleman());
      await showFormOnScreen(tester, backend);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));

      await fillIn(tester, 'Their email address', friendAddress);
      await tapThrough(tester, find.text('Show me the email'));

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('all of it can be reached at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final backend = FakeBackend()
        ..crisisCardToMake = practiceCard()
        ..crisisOffer = offer(tuttleman: tuttleman())
        ..history = [student('Help'), CrisisCardItem(), buddy('I am here.')];
      await openUnlockedApp(tester, backend);

      await openForm(tester);
      expect(tester.takeException(), isNull);
      for (final label in ['Email Tuttleman Counseling Services', 'Source: Contact Us', 'Switch to Live', 'Show me the email']) {
        await tester.ensureVisible(find.text(label, skipOffstage: false));
        await tester.pumpAndSettle();
        expect(find.text(label).hitTestable(), findsOneWidget, reason: label);
        expect(tester.takeException(), isNull);
      }

      await tester.ensureVisible(field('Their email address'));
      await tester.pump();
      await tester.enterText(field('Their email address'), friendAddress);
      await tester.pump();
      await tapThrough(tester, find.text('Show me the email'));
      expect(tester.takeException(), isNull);

      for (final label in ['Approve', 'Decline', 'Switch to Live', 'Call 988']) {
        final onCard = find.descendant(of: find.byType(Card), matching: find.text(label, skipOffstage: false), skipOffstage: false);
        await tester.ensureVisible(onCard);
        await tester.pumpAndSettle();
        expect(onCard.hitTestable(), findsOneWidget, reason: label);
        expect(tester.takeException(), isNull);
      }
    });
  });

  group('talking to the backend', () {
    final baseUrl = Uri.parse('http://backend.test');

    HttpBuddyBackend backendAnswering(int status, Object answer, List<http.Request> seen) => HttpBuddyBackend(
          baseUrl,
          deviceKey: 'key',
          onKeyRefused: () {},
          client: MockClient((request) async {
            seen.add(request);
            return http.Response(jsonEncode(answer), status, headers: {'content-type': 'application/json'});
          }),
        );

    const cardJson = {
      'id': 9,
      'title': 'Send a practice email to yourself',
      'shows': <Object>[],
      'status': 'waiting',
      'statusText': 'Waiting for your tap.',
      'fingerprint': 'abc',
      'canDecide': true,
      'crisisEmail': {'offersLive': true},
    };

    test('reads the offer', () async {
      final seen = <http.Request>[];
      final read = await backendAnswering(200, {
        'offer': {'whyNotYet': 'Not yet.', 'isLive': true, 'ownAddress': ownAddress, 'tuttleman': null},
      }, seen).loadCrisisEmailOffer();

      expect(seen.single.url.path, '/crisis-email/offer');
      expect(seen.single.headers['authorization'], 'Bearer key');
      expect(read.whyNotYet, 'Not yet.');
      expect(read.isLive, isTrue);
      expect(read.ownAddress, ownAddress);
      expect(read.tuttleman, isNull);
    });

    test('asks for a card with the exact words, and reads what it says about Live', () async {
      final seen = <http.Request>[];
      final card = await backendAnswering(200, {'card': cardJson}, seen).askForCrisisEmailCard(name: 'Sam', address: friendAddress, subject: 'S', body: 'B');

      expect(seen.single.method, 'POST');
      expect(seen.single.url.path, '/crisis-email/card');
      expect(jsonDecode(seen.single.body), {'name': 'Sam', 'address': friendAddress, 'subject': 'S', 'body': 'B'});
      expect(card.isCrisisEmail, isTrue);
      expect(card.offersLive, isTrue);
    });

    test('an ordinary card is neither', () {
      final card = ActionCard.fromJson({...cardJson}..remove('crisisEmail'));
      expect(card.isCrisisEmail, isFalse);
      expect(card.offersLive, isFalse);
    });

    test('says why it refused', () async {
      await expectLater(
        backendAnswering(409, {'error': 'Not yet.'}, []).askForCrisisEmailCard(name: '', address: friendAddress, subject: 'S', body: 'B'),
        throwsA(isA<SendingRefused>().having((refused) => refused.message, 'message', 'Not yet.')),
      );
    });

    test('switches a card to Live by its number alone', () async {
      final seen = <http.Request>[];
      await backendAnswering(200, {'card': cardJson}, seen).switchCrisisEmailToLive(9);

      expect(seen.single.method, 'POST');
      expect(seen.single.url.path, '/crisis-email/cards/9/live');
      expect(seen.single.body, isEmpty);
    });
  });
}
