import type { OfficialRole } from '../../db/schema';
import type { PeriodScore, Rec } from './coerce';

export interface ParsedSeason {
	id: number;
	startYear: number | null;
	name: string | null;
	shortName: string | null;
	beginsOn: string | null;
	endsOn: string | null;
	isCurrent: boolean | null;
	raw: Rec;
}

export interface IdName {
	id: number;
	name: string | null;
}

export interface ParsedCompetition {
	id: number;
	name: string | null;
	seasonId: number | null;
	seasonName: string | null;
	areaId: number | null;
	isFemale: boolean | null;
	category: IdName | null;
	league: IdName | null;
	raw: Rec;
}

export interface ParsedPhase {
	id: number;
	competitionId: number | null;
	name: string | null;
	typeId: number | null;
	typeName: string | null;
	raw: Rec;
}

export interface ParsedPerson {
	/** v2 user ID */
	id: number;
	/** canonical person ID (v2 `groupby` / `uNgroup`, = v1 person ID) */
	groupId: number | null;
	firstName: string | null;
	lastName: string | null;
}

export interface ParsedOfficial extends ParsedPerson {
	/** Referee evaluation { home, guest, commissioner } as sent by ČBF, null when absent. */
	ratings: Rec | null;
}

/** `official: null` means the source explicitly says the role is vacant. */
export interface ObservedOfficial {
	role: OfficialRole;
	official: ParsedOfficial | null;
}

export interface ParsedTeamRef {
	/** v2 team ID (per season); null for v1, which only knows the group ID */
	id: number | null;
	groupId: number | null;
	name: string | null;
	abbr: string | null;
}

export interface ParsedVenue {
	hallId: number | null;
	name: string | null;
	street: string | null;
	city: string | null;
	zip: string | null;
	lat: number | null;
	lon: number | null;
}

export interface ParsedGame {
	id: number;
	phaseId: number | null;
	competitionId: number | null;
	round: string | null;
	number: string | null;
	scheduledDate: string | null;
	scheduledTime: string | null;
	startsAt: Date | null;
	home: ParsedTeamRef;
	away: ParsedTeamRef;
	homeScore: number | null;
	awayScore: number | null;
	homePoints: number | null;
	awayPoints: number | null;
	quarters: PeriodScore[];
	quartersRaw: string | null;
	venue: ParsedVenue | null;
	urlLive: string | null;
	videoUrl: string | null;
	isTv: boolean | null;
	resultChecked: boolean | null;
	attendance: number | null;
	/** Only roles the payload actually carries; missing or hidden roles are "unknown", not "vacant". */
	officials: ObservedOfficial[];
	raw: Rec;
}

/** v1 sched.php person reference: v1 IDs are canonical person IDs (= v2 `uNgroup`). */
export interface V1OfficialRef {
	gameId: number;
	role: OfficialRole;
	groupId: number;
	firstName: string | null;
	lastName: string | null;
}

export interface ParsedPlayerGameStats {
	player: ParsedPerson;
	teamId: number | null;
	jersey: string | null;
	isGuest: boolean | null;
	raw: Rec;
}

export interface ParsedTeamGameStats {
	teamId: number;
	groupId: number | null;
	isGuest: boolean | null;
	raw: Rec;
}

export interface ParsedGameDetail {
	game: ParsedGame | null;
	players: ParsedPlayerGameStats[];
	teams: ParsedTeamGameStats[];
}

export interface ParsedStanding {
	teamId: number;
	teamGroupId: number | null;
	competitionId: number | null;
	teamName: string | null;
	teamAbbr: string | null;
	position: number | null;
	gamesPlayed: number | null;
	wins: number | null;
	losses: number | null;
	pointsFor: number | null;
	pointsAgainst: number | null;
	points: number | null;
	raw: Rec;
}

export interface ParsedTeam {
	id: number;
	groupId: number | null;
	name: string | null;
	shortName: string | null;
	abbr: string | null;
	isFemale: boolean | null;
	web: string | null;
	email: string | null;
	street: string | null;
	city: string | null;
	zip: string | null;
	phones: string[];
	categoryId: number | null;
	club: IdName | null;
	raw: Rec;
}

export interface ParsedRosterEntry {
	player: ParsedPerson & { height: number | null };
	jersey: string | null;
	raw: Rec;
}

export interface ParsedV1Competition {
	id: number;
	name: string | null;
	category: IdName | null;
	league: IdName | null;
	flags: Record<string, boolean | null>;
	phases: { id: number; name: string | null; typeId: number | null }[];
	raw: Rec;
}
