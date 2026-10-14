import type { OfficialRole } from '../../db/schema';
import type { PeriodScore, Rec } from './coerce';

export interface ParsedSeason {
	id: number;
	startYear: number | null;
	name: string | null;
	shortName: string | null;
	isCurrent: boolean | null;
	raw: Rec;
}

export interface ParsedCompetition {
	id: number;
	name: string | null;
	seasonId: number | null;
	seasonName: string | null;
	isFemale: boolean | null;
	category: {
		id: number;
		name: string | null;
		groupId: number | null;
		groupName: string | null;
	} | null;
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
	id: number;
	firstName: string | null;
	lastName: string | null;
}

/** `official: null` means the source explicitly says the role is vacant. */
export interface ObservedOfficial {
	role: OfficialRole;
	official: ParsedPerson | null;
}

export interface ParsedTeamRef {
	id: number | null;
	name: string | null;
	abbr: string | null;
}

export interface ParsedVenue {
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
	/** Only roles the payload actually carries; missing roles are "unknown", not "vacant". */
	officials: ObservedOfficial[];
	raw: Rec;
}

export interface ParsedStanding {
	teamId: number;
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
	club: { id: number; name: string | null } | null;
	raw: Rec;
}

export interface ParsedRosterEntry {
	player: ParsedPerson & { birthYear: number | null };
	jersey: string | null;
	raw: Rec;
}

export interface ParsedV1Competition {
	id: number;
	name: string | null;
	flags: Record<string, boolean | null>;
	phases: { id: number; name: string | null }[];
	raw: Rec;
}
