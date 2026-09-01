export const STATUS_BAR_SEGMENTS = 20;
export const SERVER_QUEUE_CAPACITY = 25;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createCapacityBar(
  value,
  maximum,
  { segments = STATUS_BAR_SEGMENTS } = {}
) {
  const safeMaximum = Number.isFinite(maximum) && maximum > 0 ? maximum : 1;
  const safeValue = Number.isFinite(value)
    ? clamp(value, 0, safeMaximum)
    : 0;
  const percentage = Math.round((safeValue / safeMaximum) * 100);
  const filledSegments = Math.round((safeValue / safeMaximum) * segments);
  const bar = '█'.repeat(filledSegments) + '░'.repeat(segments - filledSegments);

  return {
    bar,
    percentage,
    value: safeValue,
    maximum: safeMaximum
  };
}

export function formatCapacityField(value, maximum) {
  const capacity = createCapacityBar(value, maximum);

  return (
    `\`\`\`${capacity.bar}\`\`\`\n` +
    `**${capacity.value}/${capacity.maximum}** • ${capacity.percentage}%`
  );
}
