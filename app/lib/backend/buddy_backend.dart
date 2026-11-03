import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../briefings/briefing_backend.dart';
import '../device/device_store.dart';
import '../device/pairing_details.dart';
import '../roadmap/roadmap_backend.dart';
import '../sending/sending_backend.dart';

/// A pairing request gets this long. Without Tailscale on, the phone would otherwise wait minutes.
const _pairingTimeout = Duration(seconds: 20);

/// One thing in the conversation, in the order the Student sees them.
sealed class ConversationItem {
  const ConversationItem();
}

/// A Crisis card that was shown. The card's content lives in the app, in crisis_card.dart.
/// Not const, so that each card is its own object and the newest can be told from earlier ones.
class CrisisCardItem extends ConversationItem {
  CrisisCardItem();

  /// Here rather than on the screen, which forgets a card as the list scrolls and new messages move it.
  final CrisisEmailWords emailWords = CrisisEmailWords();
}

/// What the Student has written so far on a Crisis card's offer to email someone.
class CrisisEmailWords {
  bool isOpen = false;
  String name = '';
  String address = '';

  /// Null until the Student changes the words the card starts with.
  String? subject;
  String? body;
}

/// A Read Permission card that Buddy suggested. Its content comes from the backend's list of
/// Connections, never from the model.
class ReadPermissionCardItem extends ConversationItem {
  const ReadPermissionCardItem(this.connectionId);

  final String connectionId;
}

/// A Guidebook card in the conversation. Not const, so that each is its own object and the newest
/// can be told from earlier ones. With no item, the item has been reported or has left its Source.
class GuidebookCardItem extends ConversationItem {
  GuidebookCardItem(this.item, {this.reportedJustNow = false});

  final GuidebookItem? item;

  /// True when the Student has just reported it, so that they're told it worked.
  final bool reportedJustNow;
}

/// An Action card in the conversation. Not const, so that each is its own object and the newest can
/// be told from earlier ones.
class ActionCardItem extends ConversationItem {
  ActionCardItem(this.card);

  final ActionCard card;
}

/// One line of what an Action card says will happen.
class CardLine {
  const CardLine({required this.label, required this.value});

  factory CardLine.fromJson(Map<String, dynamic> json) =>
      CardLine(label: json['label'] as String, value: json['value'] as String);

  final String label;
  final String value;
}

/// A step Buddy is asking the Student's Permission for, in the backend's words. Everything on it
/// comes from the backend, which decides what each status means, so the app only shows it.
class ActionCard {
  const ActionCard({
    required this.id,
    required this.title,
    required this.shows,
    required this.status,
    required this.statusText,
    this.note,
    this.outcome,
    required this.fingerprint,
    required this.canDecide,
    this.isCrisisEmail = false,
    this.offersLive = false,
  });

  factory ActionCard.fromJson(Map<String, dynamic> json) => ActionCard(
        id: json['id'] as int,
        title: json['title'] as String,
        shows: [for (final line in json['shows'] as List<dynamic>) CardLine.fromJson(line as Map<String, dynamic>)],
        status: json['status'] as String,
        statusText: json['statusText'] as String,
        note: json['note'] as String?,
        outcome: json['outcome'] as String?,
        fingerprint: json['fingerprint'] as String,
        canDecide: json['canDecide'] as bool,
        isCrisisEmail: json['crisisEmail'] != null,
        offersLive: (json['crisisEmail'] as Map<String, dynamic>?)?['offersLive'] == true,
      );

  /// An email from the Crisis card, which keeps a way to help next to it.
  final bool isCrisisEmail;

  /// A Practice card for such an email, which offers to switch to Live while it's waiting.
  final bool offersLive;

  final int id;
  final String title;

  /// Exactly what will happen, line by line.
  final List<CardLine> shows;
  final String status;
  final String statusText;

  /// What the Student should know before they tap.
  final String? note;

  /// What happened in the end.
  final String? outcome;

  /// Sent back with Approve, to say which content the Student saw.
  final String fingerprint;

  /// Whether Approve and Decline still mean anything.
  final bool canDecide;

  bool get isRunning => status == 'running';
}

/// What the backend said to a tap on an Action card.
class ActionCardAnswer {
  const ActionCardAnswer(this.card, {this.refusal});

  /// The card as it is now.
  final ActionCard card;

  /// Why the tap didn't count, when it didn't.
  final String? refusal;
}

/// The web page where Buddy found a Guidebook item.
class GuidebookSource {
  const GuidebookSource({required this.url, required this.title, required this.lastSeenAt});

  factory GuidebookSource.fromJson(Map<String, dynamic> json) => GuidebookSource(
        url: json['url'] as String,
        title: json['title'] as String,
        lastSeenAt: DateTime.parse(json['lastSeenAt'] as String),
      );

  final String url;
  final String title;
  final DateTime lastSeenAt;
}

/// A Resource or Contact, in the backend's words.
class GuidebookItem {
  const GuidebookItem({
    required this.id,
    required this.name,
    required this.summary,
    this.cost,
    this.phone,
    this.phoneToDial,
    this.email,
    this.place,
    this.hours,
    required this.sources,
  });

  factory GuidebookItem.fromJson(Map<String, dynamic> json) => GuidebookItem(
        id: json['id'] as int,
        name: json['name'] as String,
        summary: json['summary'] as String,
        cost: json['cost'] as String?,
        phone: json['phone'] as String?,
        phoneToDial: json['phoneToDial'] as String?,
        email: json['email'] as String?,
        place: json['place'] as String?,
        hours: json['hours'] as String?,
        sources: [
          for (final source in json['sources'] as List<dynamic>) GuidebookSource.fromJson(source as Map<String, dynamic>),
        ],
      );

  final int id;
  final String name;
  final String summary;
  final String? cost;
  final String? phone;

  /// For the phone's dialer, when [phone] is a number it can use.
  final String? phoneToDial;
  final String? email;
  final String? place;
  final String? hours;
  final List<GuidebookSource> sources;
}

/// A message Buddy prepared for the Student to send to a Contact. With no contact, the Contact has
/// been reported or has left its Source.
class Draft {
  const Draft({required this.id, this.contact, this.why, required this.subject, required this.body});

  factory Draft.fromJson(Map<String, dynamic> json) => Draft(
        id: json['id'] as int,
        contact: switch (json['contact']) {
          final Map<String, dynamic> contact => GuidebookItem.fromJson(contact),
          _ => null,
        },
        why: json['why'] as String?,
        subject: json['subject'] as String,
        body: json['body'] as String,
      );

  final int id;
  final GuidebookItem? contact;

  /// Why Buddy picked this Contact. It can name them, so it goes when they do.
  final String? why;
  final String subject;
  final String body;

  Draft withoutContact() => Draft(id: id, subject: subject, body: body);
}

/// A Draft after the Student's edit, which may differ from what they typed.
class EditedDraft {
  const EditedDraft({required this.draft, this.hiddenNote});

  final Draft draft;

  /// What to tell the Student if something in their edit was hidden.
  final String? hiddenNote;
}

/// A Draft card in the conversation. Not const, so that the newest can be told from earlier ones.
class DraftCardItem extends ConversationItem {
  DraftCardItem(this.draft);

  final Draft draft;
}

/// A date every Temple Student faces, in the backend's words.
class StandardMilestone {
  const StandardMilestone({
    required this.id,
    required this.name,
    this.term,
    required this.when,
    required this.passed,
    required this.sources,
  });

  factory StandardMilestone.fromJson(Map<String, dynamic> json) => StandardMilestone(
        id: json['id'] as int,
        name: json['name'] as String,
        term: json['term'] as String?,
        when: json['when'] as String,
        passed: json['passed'] as bool,
        sources: [
          for (final source in json['sources'] as List<dynamic>) GuidebookSource.fromJson(source as Map<String, dynamic>),
        ],
      );

  final int id;
  final String name;
  final String? term;

  /// The date in words.
  final String when;
  final bool passed;
  final List<GuidebookSource> sources;
}

/// Something with a deadline or a date, as the backend shows it. Everything here comes from its record of the
/// page, never from what Claude wrote.
class Opportunity {
  const Opportunity({
    required this.id,
    required this.name,
    required this.summary,
    required this.when,
    required this.cost,
    this.worthItBecause,
    required this.outsideTemple,
    this.place,
    this.forGoals = const [],
    required this.saved,
    required this.sources,
  });

  factory Opportunity.fromJson(Map<String, dynamic> json) => Opportunity(
        id: json['id'] as int,
        name: json['name'] as String,
        summary: json['summary'] as String,
        when: json['when'] as String,
        cost: json['cost'] as String,
        worthItBecause: json['worthItBecause'] as String?,
        outsideTemple: json['outsideTemple'] as bool,
        place: json['place'] as String?,
        forGoals: [for (final goal in json['forGoals'] as List<dynamic>) goal as String],
        saved: json['saved'] as bool,
        sources: [
          for (final source in json['sources'] as List<dynamic>) GuidebookSource.fromJson(source as Map<String, dynamic>),
        ],
      );

  final int id;
  final String name;
  final String summary;

  /// The date in words.
  final String when;

  /// What it costs in Buddy's own words, which always says something.
  final String cost;

  /// The one line on why it's worth its fee. Anything with a fee has one.
  final String? worthItBecause;
  final bool outsideTemple;
  final String? place;
  final List<String> forGoals;
  final bool saved;
  final List<GuidebookSource> sources;
}

/// An Opportunity's card in the conversation. Not const, so that each is its own object and the newest can
/// be told from earlier ones. With no Opportunity, Buddy no longer shows it.
class OpportunityCardItem extends ConversationItem {
  OpportunityCardItem(this.opportunity);

  final Opportunity? opportunity;
}

/// A Standard Milestone's card in the conversation. Not const, so that each is its own object and
/// the newest can be told from earlier ones. With no Milestone, its date has gone from its Source.
class MilestoneCardItem extends ConversationItem {
  MilestoneCardItem(this.milestone);

  final StandardMilestone? milestone;
}

/// A Roadmap card in the conversation. Not const, so that each is its own object and the newest can
/// be told from earlier ones.
class RoadmapCardItem extends ConversationItem {
  RoadmapCardItem(this.card);

  final RoadmapCard card;
}

class ChatMessage extends ConversationItem {
  const ChatMessage({required this.isFromBuddy, required this.text, this.hiddenNote});

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        isFromBuddy: json['role'] == 'buddy',
        text: json['text'] as String,
        hiddenNote: json['hiddenNote'] as String?,
      );

  final bool isFromBuddy;
  final String text;

  /// On a Student's message that had something hidden, what to tell them about it.
  final String? hiddenNote;
}

/// Something Buddy knows about the Student, and where it came from.
class ProfileFact {
  const ProfileFact({
    required this.id,
    required this.text,
    this.detail,
    this.connectionName,
    required this.isFromConversation,
    required this.savedAt,
    required this.wasEdited,
  });

  factory ProfileFact.fromJson(Map<String, dynamic> json) => ProfileFact(
        id: json['id'] as int,
        text: json['text'] as String,
        detail: json['detail'] as String?,
        connectionName: (json['origin'] as Map<String, dynamic>)['name'] as String?,
        isFromConversation: (json['origin'] as Map<String, dynamic>)['type'] == 'conversation',
        savedAt: DateTime.parse(json['savedAt'] as String),
        wasEdited: json['editedAt'] != null,
      );

  final int id;
  final String text;

  /// Written by the backend and shown below the text, such as when a calendar event happens.
  final String? detail;

  /// The Connection it came from, if it came from one.
  final String? connectionName;
  final bool isFromConversation;
  final DateTime savedAt;
  final bool wasEdited;
}

/// A fact after the Student's edit, which may differ from what they typed.
class EditedFact {
  const EditedFact({required this.fact, this.hiddenNote});

  final ProfileFact fact;

  /// What to tell the Student if something in their edit was hidden.
  final String? hiddenNote;
}

/// The address the Student must paste to connect, and how to find it.
class AddressRequest {
  const AddressRequest({required this.label, required this.steps});

  factory AddressRequest.fromJson(Map<String, dynamic> json) => AddressRequest(
        label: json['label'] as String,
        steps: [for (final step in json['steps'] as List<dynamic>) step as String],
      );

  final String label;
  final List<String> steps;
}

/// What the Read Permission card says.
class ReadPermissionCardContent {
  const ReadPermissionCardContent({required this.reads, required this.notes, this.warning, this.address});

  factory ReadPermissionCardContent.fromJson(Map<String, dynamic> json) => ReadPermissionCardContent(
        reads: [for (final line in json['reads'] as List<dynamic>) line as String],
        notes: [for (final line in json['notes'] as List<dynamic>) line as String],
        warning: json['warning'] as String?,
        address: switch (json['address']) {
          final Map<String, dynamic> address => AddressRequest.fromJson(address),
          _ => null,
        },
      );

  /// Exactly what Buddy will read.
  final List<String> reads;
  final List<String> notes;

  /// Says so when the service's own rules forbid automated tools.
  final String? warning;
  final AddressRequest? address;
}

/// A system Buddy can read for the Student, once they give its Read Permission.
class Connection {
  const Connection({
    required this.id,
    required this.name,
    required this.on,
    this.lastReadAt,
    this.lastReadProblem,
    this.logsIn = false,
    this.needsLogin = false,
    this.loginNotDeletedYet = false,
    required this.card,
  });

  factory Connection.fromJson(Map<String, dynamic> json) => Connection(
        id: json['id'] as String,
        name: json['name'] as String,
        on: json['on'] as bool,
        lastReadAt: switch (json['lastReadAt']) {
          final String at => DateTime.parse(at),
          _ => null,
        },
        lastReadProblem: json['lastReadProblem'] as String?,
        logsIn: json['logsIn'] as bool? ?? false,
        needsLogin: json['needsLogin'] as bool? ?? false,
        loginNotDeletedYet: json['loginNotDeletedYet'] as bool? ?? false,
        card: ReadPermissionCardContent.fromJson(json['card'] as Map<String, dynamic>),
      );

  final String id;
  final String name;
  final bool on;
  final DateTime? lastReadAt;

  /// What went wrong the last time Buddy tried to read it, for the Student to read.
  final String? lastReadProblem;

  /// The Student logs in to this through a Takeover.
  final bool logsIn;

  /// Buddy's Browser isn't logged in to it, so Buddy is asking for a Takeover.
  final bool needsLogin;

  /// Its Read Permission was revoked, but its login couldn't be deleted yet. Buddy keeps trying.
  final bool loginNotDeletedYet;
  final ReadPermissionCardContent card;
}

/// A page Buddy looked at for a reply.
class DecisionSource {
  const DecisionSource({required this.title, required this.url});

  factory DecisionSource.fromJson(Map<String, dynamic> json) =>
      DecisionSource(title: json['title'] as String, url: json['url'] as String);

  final String title;
  final String url;
}

/// A Profile fact as Buddy had it when it wrote a reply.
class DecisionFact {
  const DecisionFact({required this.text, this.detail, required this.from});

  factory DecisionFact.fromJson(Map<String, dynamic> json) => DecisionFact(
        text: json['text'] as String,
        detail: json['detail'] as String?,
        from: json['from'] as String,
      );

  final String text;
  final String? detail;

  /// Where the fact came from, in the backend's words.
  final String from;
}

/// How Buddy decided one reply, as it was at the time.
class ReplyDecision {
  const ReplyDecision({required this.reply, required this.tools, required this.sources, required this.facts});

  factory ReplyDecision.fromJson(Map<String, dynamic> json) => ReplyDecision(
        reply: json['reply'] as String,
        tools: [for (final tool in json['tools'] as List<dynamic>) tool as String],
        sources: [
          for (final source in json['sources'] as List<dynamic>) DecisionSource.fromJson(source as Map<String, dynamic>),
        ],
        facts: [for (final fact in json['facts'] as List<dynamic>) DecisionFact.fromJson(fact as Map<String, dynamic>)],
      );

  final String reply;
  final List<String> tools;
  final List<DecisionSource> sources;
  final List<DecisionFact> facts;
}

/// One thing in the Student's record of what Buddy read and did. All of it is in the backend's own
/// words, so that an entry of a kind added later shows up without a new version of the app.
class ActivityEntry {
  const ActivityEntry({required this.title, this.detail, required this.at, this.decision});

  factory ActivityEntry.fromJson(Map<String, dynamic> json) => ActivityEntry(
        title: json['title'] as String,
        detail: json['detail'] as String?,
        at: DateTime.parse(json['at'] as String),
        decision: switch (json['decision']) {
          final Map<String, dynamic> decision => ReplyDecision.fromJson(decision),
          _ => null,
        },
      );

  final String title;
  final String? detail;
  final DateTime at;

  /// How Buddy decided, on an entry for a reply.
  final ReplyDecision? decision;
}

sealed class ReplyEvent {
  const ReplyEvent();
}

/// The Student's message had something hidden. [text] is the message as Buddy kept it.
class ReplyHidden extends ReplyEvent {
  const ReplyHidden({required this.text, required this.note});
  final String text;
  final String note;
}

/// More of Buddy's reply, as Claude writes it.
class ReplyText extends ReplyEvent {
  const ReplyText(this.text);
  final String text;
}

/// Buddy is showing the Crisis card. It comes as soon as the backend knows, ahead of any reply.
class ReplyCrisisCard extends ReplyEvent {
  const ReplyCrisisCard();
}

/// Buddy is suggesting a Connection, with its Read Permission card.
class ReplyReadPermissionCard extends ReplyEvent {
  const ReplyReadPermissionCard(this.connectionId);
  final String connectionId;
}

/// Buddy is showing a Standard Milestone's card.
class ReplyMilestoneCard extends ReplyEvent {
  const ReplyMilestoneCard(this.milestone);
  final StandardMilestone milestone;
}

/// Buddy is showing an Opportunity's card.
class ReplyOpportunityCard extends ReplyEvent {
  const ReplyOpportunityCard(this.opportunity);
  final Opportunity opportunity;
}

/// Buddy is showing a Roadmap card.
class ReplyRoadmapCard extends ReplyEvent {
  const ReplyRoadmapCard(this.card);
  final RoadmapCard card;
}

/// Buddy is showing a Guidebook card.
class ReplyGuidebookCard extends ReplyEvent {
  const ReplyGuidebookCard(this.item);
  final GuidebookItem item;
}

/// Buddy is asking for an Action Permission, with an Action card.
class ReplyActionCard extends ReplyEvent {
  const ReplyActionCard(this.card);
  final ActionCard card;
}

/// Buddy is showing a Draft card.
class ReplyDraftCard extends ReplyEvent {
  const ReplyDraftCard(this.draft);
  final Draft draft;
}

/// The turn ended. This is the reply as saved, and it replaces whatever streamed in.
class ReplyDone extends ReplyEvent {
  const ReplyDone(this.reply);
  final ChatMessage reply;
}

/// The turn failed, and [message] is meant for the Student.
class ReplyFailed extends ReplyEvent {
  const ReplyFailed(this.message);
  final String message;
}

class BackendException implements Exception {
  const BackendException(this.message);
  final String message;

  @override
  String toString() => 'BackendException: $message';
}

/// The backend said no to a pairing code.
class PairingRefused implements Exception {
  const PairingRefused();
}

/// The backend said no to a Read Permission, and [message] is meant for the Student.
class ReadPermissionRefused implements Exception {
  const ReadPermissionRefused(this.message);
  final String message;
}

/// The Student in control of Buddy's Browser.
class Takeover {
  const Takeover({
    required this.site,
    required this.siteName,
    required this.liveViewUrl,
    this.liveViewHeaders = const {},
  });

  final String site;
  final String siteName;

  /// Always an address on the backend. The app never connects to the browser directly.
  final Uri liveViewUrl;

  /// What the live view must open its page with.
  final Map<String, String> liveViewHeaders;
}

/// What came of tapping Done.
class FinishedTakeover {
  const FinishedTakeover({required this.siteName, required this.signedIn, this.title});

  factory FinishedTakeover.fromJson(Map<String, dynamic> json) => FinishedTakeover(
        siteName: json['siteName'] as String,
        signedIn: json['signedIn'] as bool,
        title: json['title'] as String?,
      );

  final String siteName;
  final bool signedIn;

  /// The title of the page Buddy read to check the login.
  final String? title;
}

/// What the app needs from the backend.
abstract interface class BuddyBackend implements RoadmapBackend, SendingBackend, BriefingBackend {
  Future<List<ConversationItem>> loadHistory();

  /// Sends the Student's message. The stream carries Buddy's turn.
  Stream<ReplyEvent> send(String text);

  Future<List<ProfileFact>> loadFacts();

  /// Returns the fact as saved, or null if it was already gone.
  Future<EditedFact?> editFact(int id, String text);

  /// Also succeeds if the fact was already gone.
  Future<void> deleteFact(int id);

  Future<List<Connection>> loadConnections();

  /// The Student's tap on the card. Throws [ReadPermissionRefused] if the backend says no.
  Future<Connection> giveReadPermission(String id, String? address);

  /// Also deletes what Buddy saved from this Connection.
  Future<Connection> revokeReadPermission(String id);

  /// Reads now. A read that fails shows in what comes back.
  Future<Connection> readConnection(String id);

  /// Hides the item for every Student. Also succeeds if the item has already gone.
  Future<void> reportGuidebookItem(int id);

  /// The Student's Approve tap, with the fingerprint of what the card showed. It's the only way an
  /// Action Permission is ever given. Sending it twice is safe: the step still runs at most once.
  /// Throws only if there's no telling what the backend did.
  Future<ActionCardAnswer> approveActionCard(int id, String fingerprint);

  /// The Student's Decline tap.
  Future<ActionCardAnswer> declineActionCard(int id);

  /// The card as it is now.
  Future<ActionCard> loadActionCard(int id);

  /// Saves the Student's changes to a Draft, and returns it as saved.
  Future<EditedDraft> editDraft(int id, {required String subject, required String body});

  /// The Standard Milestones still to come, soonest first.
  Future<List<StandardMilestone>> loadUpcomingMilestones();

  /// Temple's first, then those outside Temple. Nothing whose date has passed.
  Future<List<Opportunity>> loadOpportunities();

  /// Saving one twice changes nothing.
  Future<void> setOpportunitySaved(int id, bool saved);

  /// Hides it for every Student. Also succeeds if it has already gone.
  Future<void> reportOpportunity(int id);

  /// Newest first. There's nothing here to change or remove an entry, because nothing can.
  Future<List<ActivityEntry>> loadActivity();

  /// The Takeover under way, if there is one.
  Future<Takeover?> currentTakeover();

  /// Gives the Student control of Buddy's Browser, on this site.
  Future<Takeover> startTakeover(String site);

  /// Hands control back to Buddy. Returns null if the Takeover had already ended.
  Future<FinishedTakeover?> finishTakeover();
}

/// How the app gets a device key, and a backend that uses it.
abstract interface class BackendAccess {
  /// Throws [PairingRefused] if the backend says no to the code, or another exception if it
  /// can't be reached.
  Future<PairedDevice> pair(PairingDetails details);

  /// [onKeyRefused] runs when the backend no longer accepts this phone's key.
  BuddyBackend open(PairedDevice device, {required void Function() onKeyRefused});
}

class HttpBackendAccess implements BackendAccess {
  HttpBackendAccess({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  @override
  Future<PairedDevice> pair(PairingDetails details) async {
    final response = await _client
        .post(
          details.address.resolve('/devices/pair'),
          headers: {'content-type': 'application/json'},
          body: jsonEncode({'code': details.code}),
        )
        .timeout(_pairingTimeout);
    if (response.statusCode == 401) throw const PairingRefused();
    if (response.statusCode != 200) {
      throw BackendException('Pairing failed with ${response.statusCode}');
    }
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return PairedDevice(address: details.address, key: body['deviceKey'] as String);
  }

  @override
  BuddyBackend open(PairedDevice device, {required void Function() onKeyRefused}) => HttpBuddyBackend(
        device.address,
        deviceKey: device.key,
        onKeyRefused: onKeyRefused,
        client: _client,
      );
}

class HttpBuddyBackend with HttpRoadmapCalls, HttpSendingCalls, HttpBriefingCalls implements BuddyBackend {
  HttpBuddyBackend(
    Uri baseUrl, {
    required String deviceKey,
    required this._onKeyRefused,
    http.Client? client,
  })  : _baseUrl = baseUrl,
        _messagesUrl = baseUrl.resolve('/conversation/messages'),
        _takeoverUrl = baseUrl.resolve('/takeover'),
        _factsUrl = baseUrl.resolve('/profile/facts'),
        _connectionsUrl = baseUrl.resolve('/connections'),
        _activityUrl = baseUrl.resolve('/activity'),
        _keyHeader = {'authorization': 'Bearer $deviceKey'},
        _client = client ?? http.Client();

  final Uri _baseUrl;
  final Uri _messagesUrl;
  final Uri _takeoverUrl;
  final Uri _factsUrl;
  final Uri _connectionsUrl;
  final Uri _activityUrl;
  final Map<String, String> _keyHeader;
  final void Function() _onKeyRefused;
  final http.Client _client;

  /// Throws unless the backend said yes. Every response comes through here, so that a refused key
  /// is noticed whichever operation meets it.
  void _check(int status, String failure) {
    if (status == 200) return;
    if (status == 401) _onKeyRefused();
    throw BackendException('$failure failed with $status');
  }

  @override
  Future<List<ConversationItem>> loadHistory() async {
    final response = await _client.get(_messagesUrl, headers: _keyHeader);
    _check(response.statusCode, 'Loading history');
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return [
      if (body['opening'] case final String opening) ChatMessage(isFromBuddy: true, text: opening),
      for (final item in body['messages'] as List<dynamic>) _parseItem(item as Map<String, dynamic>),
    ];
  }

  @override
  Future<List<ProfileFact>> loadFacts() async {
    final response = await _client.get(_factsUrl, headers: _keyHeader);
    _check(response.statusCode, 'Loading the Profile');
    return [
      for (final fact in _decode(response)['facts'] as List<dynamic>) ProfileFact.fromJson(fact as Map<String, dynamic>),
    ];
  }

  @override
  Future<EditedFact?> editFact(int id, String text) async {
    final response = await _client.patch(
      _factsUrl.resolve('/profile/facts/$id'),
      headers: {..._keyHeader, 'content-type': 'application/json'},
      body: jsonEncode({'text': text}),
    );
    if (response.statusCode == 404) return null;
    _check(response.statusCode, 'Editing a fact');
    final body = _decode(response);
    return EditedFact(
      fact: ProfileFact.fromJson(body['fact'] as Map<String, dynamic>),
      hiddenNote: body['hiddenNote'] as String?,
    );
  }

  @override
  Future<void> deleteFact(int id) async {
    final response = await _client.delete(_factsUrl.resolve('/profile/facts/$id'), headers: _keyHeader);
    if (response.statusCode == 204 || response.statusCode == 404) return;
    _check(response.statusCode, 'Deleting a fact');
  }

  @override
  Future<List<Connection>> loadConnections() async {
    final response = await _client.get(_connectionsUrl, headers: _keyHeader);
    _check(response.statusCode, 'Loading Connections');
    return [
      for (final connection in _decode(response)['connections'] as List<dynamic>)
        Connection.fromJson(connection as Map<String, dynamic>),
    ];
  }

  Uri _connectionUrl(String id, String action) =>
      _baseUrl.replace(pathSegments: ['connections', id, action]);

  Connection _parseConnection(http.Response response) =>
      Connection.fromJson(_decode(response)['connection'] as Map<String, dynamic>);

  @override
  Future<Connection> giveReadPermission(String id, String? address) async {
    final response = await _client.post(
      _connectionUrl(id, 'read-permission'),
      headers: {..._keyHeader, 'content-type': 'application/json'},
      body: jsonEncode({'address': address}),
    );
    if (response.statusCode == 400 || response.statusCode == 409) {
      throw ReadPermissionRefused(_decode(response)['error'] as String);
    }
    _check(response.statusCode, 'Giving a Read Permission');
    return _parseConnection(response);
  }

  @override
  Future<Connection> revokeReadPermission(String id) async {
    final response = await _client.delete(_connectionUrl(id, 'read-permission'), headers: _keyHeader);
    _check(response.statusCode, 'Revoking a Read Permission');
    return _parseConnection(response);
  }

  @override
  Future<Connection> readConnection(String id) async {
    final response = await _client.post(_connectionUrl(id, 'read'), headers: _keyHeader);
    _check(response.statusCode, 'Reading a Connection');
    return _parseConnection(response);
  }

  @override
  Future<void> reportGuidebookItem(int id) async {
    final response = await _client.post(_baseUrl.replace(pathSegments: ['guidebook', 'items', '$id', 'report']), headers: _keyHeader);
    if (response.statusCode == 204 || response.statusCode == 404) return;
    _check(response.statusCode, 'Sending a Report');
  }

  @override
  Future<List<Opportunity>> loadOpportunities() async {
    final response = await _client.get(_baseUrl.replace(pathSegments: ['opportunities']), headers: _keyHeader);
    _check(response.statusCode, 'Loading Opportunities');
    return [
      for (final opportunity in _decode(response)['opportunities'] as List<dynamic>)
        Opportunity.fromJson(opportunity as Map<String, dynamic>),
    ];
  }

  @override
  Future<void> setOpportunitySaved(int id, bool saved) async {
    final url = _baseUrl.replace(pathSegments: ['opportunities', '$id', 'saved']);
    final response = saved ? await _client.put(url, headers: _keyHeader) : await _client.delete(url, headers: _keyHeader);
    if (response.statusCode == 204) return;
    _check(response.statusCode, saved ? 'Saving an Opportunity' : 'Removing a saved Opportunity');
  }

  @override
  Future<void> reportOpportunity(int id) async {
    final response = await _client.post(_baseUrl.replace(pathSegments: ['opportunities', '$id', 'report']), headers: _keyHeader);
    if (response.statusCode == 204 || response.statusCode == 404) return;
    _check(response.statusCode, 'Sending a Report');
  }

  Uri _actionCardUrl(int id, [String? operation]) =>
      _baseUrl.replace(pathSegments: ['action-cards', '$id', ?operation]);

  ActionCardAnswer _parseCardAnswer(http.Response response, String failure) {
    if (response.statusCode == 409) {
      final body = _decode(response);
      return ActionCardAnswer(
        ActionCard.fromJson(body['card'] as Map<String, dynamic>),
        refusal: body['error'] as String,
      );
    }
    _check(response.statusCode, failure);
    return ActionCardAnswer(ActionCard.fromJson(_decode(response)['card'] as Map<String, dynamic>));
  }

  @override
  Future<ActionCardAnswer> approveActionCard(int id, String fingerprint) async {
    final response = await _client.post(
      _actionCardUrl(id, 'approve'),
      headers: {..._keyHeader, 'content-type': 'application/json'},
      body: jsonEncode({'fingerprint': fingerprint}),
    );
    return _parseCardAnswer(response, 'Approving');
  }

  @override
  Future<ActionCardAnswer> declineActionCard(int id) async {
    final response = await _client.post(_actionCardUrl(id, 'decline'), headers: _keyHeader);
    return _parseCardAnswer(response, 'Declining');
  }

  @override
  Future<ActionCard> loadActionCard(int id) async {
    final response = await _client.get(_actionCardUrl(id), headers: _keyHeader);
    _check(response.statusCode, 'Loading a card');
    return ActionCard.fromJson(_decode(response)['card'] as Map<String, dynamic>);
  }

  @override
  Future<EditedDraft> editDraft(int id, {required String subject, required String body}) async {
    final response = await _client.patch(
      _baseUrl.replace(pathSegments: ['drafts', '$id']),
      headers: {..._keyHeader, 'content-type': 'application/json'},
      body: jsonEncode({'subject': subject, 'body': body}),
    );
    _check(response.statusCode, 'Saving a Draft');
    final saved = _decode(response);
    return EditedDraft(
      draft: Draft.fromJson(saved['draft'] as Map<String, dynamic>),
      hiddenNote: saved['hiddenNote'] as String?,
    );
  }

  @override
  Future<List<StandardMilestone>> loadUpcomingMilestones() async {
    final response = await _client.get(_baseUrl.replace(pathSegments: ['milestones', 'upcoming']), headers: _keyHeader);
    _check(response.statusCode, 'Loading the dates coming up');
    return [
      for (final milestone in _decode(response)['milestones'] as List<dynamic>)
        StandardMilestone.fromJson(milestone as Map<String, dynamic>),
    ];
  }

  @override
  Future<List<ActivityEntry>> loadActivity() async {
    final response = await _client.get(_activityUrl, headers: _keyHeader);
    _check(response.statusCode, 'Loading Activity');
    return [
      for (final entry in _decode(response)['entries'] as List<dynamic>)
        ActivityEntry.fromJson(entry as Map<String, dynamic>),
    ];
  }

  @override
  Stream<ReplyEvent> send(String text) async* {
    final request = http.Request('POST', _messagesUrl)
      ..headers.addAll(_keyHeader)
      ..headers['content-type'] = 'application/json'
      ..body = jsonEncode({'text': text});
    final response = await _client.send(request);
    _check(response.statusCode, 'Sending');

    final lines = response.stream.transform(utf8.decoder).transform(const LineSplitter());
    await for (final line in lines) {
      if (!line.startsWith('data: ')) continue;
      final event = _parseEvent(jsonDecode(line.substring(6)) as Map<String, dynamic>);
      if (event != null) yield event;
    }
  }

  @override
  Future<Takeover?> currentTakeover() async {
    final response = await _client.get(_takeoverUrl, headers: _keyHeader);
    _check(response.statusCode, 'Checking for a Takeover');
    return _parseTakeover(_decode(response)['takeover'] as Map<String, dynamic>?);
  }

  @override
  Future<Takeover> startTakeover(String site) async {
    final response = await _client.post(
      _takeoverUrl,
      headers: {..._keyHeader, 'content-type': 'application/json'},
      body: jsonEncode({'site': site}),
    );
    _check(response.statusCode, 'Starting a Takeover');
    return _parseTakeover(_decode(response)['takeover'] as Map<String, dynamic>)!;
  }

  @override
  Future<FinishedTakeover?> finishTakeover() async {
    final response = await _client.post(_takeoverUrl.resolve('/takeover/done'), headers: _keyHeader);
    if (response.statusCode == 409) return null;
    _check(response.statusCode, 'Finishing the Takeover');
    return FinishedTakeover.fromJson(_decode(response));
  }

  @override
  Future<Map<String, dynamic>> roadmapCall(String method, String path, [Object? body]) async {
    final request = http.Request(method, _baseUrl.resolve(path))..headers.addAll(_keyHeader);
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await http.Response.fromStream(await _client.send(request));
    _check(response.statusCode, 'A Roadmap request');
    return _decode(response);
  }

  @override
  Future<Map<String, dynamic>> sendingCall(String method, String path, [Object? body]) async {
    final request = http.Request(method, _baseUrl.resolve(path))..headers.addAll(_keyHeader);
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await http.Response.fromStream(await _client.send(request));
    if (response.statusCode == 400 || response.statusCode == 409) throw SendingRefused(_decode(response)['error'] as String);
    _check(response.statusCode, 'A request about sending');
    return _decode(response);
  }

  @override
  Future<Map<String, dynamic>> briefingCall(String method, String path, [Object? body]) async {
    final request = http.Request(method, _baseUrl.resolve(path))..headers.addAll(_keyHeader);
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await http.Response.fromStream(await _client.send(request));
    if (response.statusCode == 204) return const {};
    _check(response.statusCode, 'A request about Briefings');
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) =>
      jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;

  Takeover? _parseTakeover(Map<String, dynamic>? json) => json == null
      ? null
      : Takeover(
          site: json['site'] as String,
          siteName: json['siteName'] as String,
          liveViewUrl: _baseUrl.resolve(json['liveViewPath'] as String),
          liveViewHeaders: _keyHeader,
        );

  ConversationItem _parseItem(Map<String, dynamic> json) => switch (json['type']) {
        'crisis_card' => CrisisCardItem(),
        'read_permission_card' => ReadPermissionCardItem(json['connection'] as String),
        'guidebook_card' => GuidebookCardItem(switch (json['item']) {
            final Map<String, dynamic> item => GuidebookItem.fromJson(item),
            _ => null,
          }),
        'action_card' => ActionCardItem(ActionCard.fromJson(json['card'] as Map<String, dynamic>)),
        'draft_card' => DraftCardItem(Draft.fromJson(json['draft'] as Map<String, dynamic>)),
        'milestone_card' => MilestoneCardItem(switch (json['milestone']) {
            final Map<String, dynamic> milestone => StandardMilestone.fromJson(milestone),
            _ => null,
          }),
        'opportunity_card' => OpportunityCardItem(switch (json['opportunity']) {
            final Map<String, dynamic> opportunity => Opportunity.fromJson(opportunity),
            _ => null,
          }),
        'roadmap_card' => RoadmapCardItem(RoadmapCard.fromJson(json['card'] as Map<String, dynamic>)),
        _ => ChatMessage.fromJson(json),
      };

  /// Returns null for event types added after this version of the app.
  ReplyEvent? _parseEvent(Map<String, dynamic> json) => switch (json['type']) {
        'hidden' => ReplyHidden(text: json['text'] as String, note: json['note'] as String),
        'text' => ReplyText(json['text'] as String),
        'crisis_card' => const ReplyCrisisCard(),
        'read_permission_card' => ReplyReadPermissionCard(json['connection'] as String),
        'guidebook_card' => ReplyGuidebookCard(GuidebookItem.fromJson(json['item'] as Map<String, dynamic>)),
        'action_card' => ReplyActionCard(ActionCard.fromJson(json['card'] as Map<String, dynamic>)),
        'draft_card' => ReplyDraftCard(Draft.fromJson(json['draft'] as Map<String, dynamic>)),
        'milestone_card' => ReplyMilestoneCard(StandardMilestone.fromJson(json['milestone'] as Map<String, dynamic>)),
        'opportunity_card' => ReplyOpportunityCard(Opportunity.fromJson(json['opportunity'] as Map<String, dynamic>)),
        'roadmap_card' => ReplyRoadmapCard(RoadmapCard.fromJson(json['card'] as Map<String, dynamic>)),
        'done' => ReplyDone(ChatMessage.fromJson(json['reply'] as Map<String, dynamic>)),
        'error' => ReplyFailed(json['message'] as String),
        _ => null,
      };
}
