export type EmployerShortlistItem = {
  candidateId: string;
  fullName: string;
  roleTrack: string | null;
  tier: string;
  compositeScore: number | null;
  shortlistedAt: string;
};
