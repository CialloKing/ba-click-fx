// 未发布记录不进入正式发行说明；只跳过明确标识的首节，避免隐藏版本顺序错误。
export function currentReleaseNotes(changelog)
{
  const sections = changelog.split(/^## /m).slice(1).map(section => section.trim());
  if (/^(?:未发布|Unreleased)(?:\s|$)/.test(sections[0] ?? '')) sections.shift();
  return sections[0] ?? '';
}
