// Hạng thành viên (SPEC mục 3). Một nguồn duy nhất cho nhãn hiển thị.
export type Tier = 'new' | 'regular' | 'high';

export const TIER_LABEL: Record<Tier, string> = {
  new: 'Thành viên mới',
  regular: 'Thành viên',
  high: 'Uy tín cao',
};
