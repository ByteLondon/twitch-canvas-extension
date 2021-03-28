type RewardBody = {
  id?: string
  title: string,
  prompt: string,
  cost: number,
  is_enabled: boolean,
  is_global_cooldown_enabled: boolean,
  global_cooldown_seconds: number,
}
