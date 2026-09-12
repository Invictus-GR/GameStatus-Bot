import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TICKET_CLOSE_OVERRIDE_ROLE_IDS,
  TICKET_CONFIG,
  TICKET_TRAINEE_APPROVER_ROLE_IDS,
  TICKET_TYPES
} from '../src/config/tickets.js';
import { __ticketInternals } from '../src/ticketSystem.js';

const {
  buildSupportSelectRow,
  buildTicketButtons,
  getCurrentHandlerRoleIds,
  getNextEscalationRoleIds,
  parseTicketButton,
  canApproveTrainee
} = __ticketInternals;

test('support dropdown exposes all seven TLC ticket types', () => {
  const row = buildSupportSelectRow().toJSON();
  assert.equal(row.components.length, 1);
  assert.equal(row.components[0].custom_id, 'tlc_ticket_type');
  assert.equal(row.components[0].placeholder, 'Select a ticket type...');
  assert.equal(row.components[0].options.length, 7);
  assert.deepEqual(
    row.components[0].options.map(option => option.value),
    [
      'player_report',
      'official_unit',
      'content_creator',
      'donator_support',
      'developer_application',
      'dedicated_pilot',
      'drone_operator'
    ]
  );
});

test('player report routing follows Trial/Admin -> Senior Admin -> Owner', () => {
  const ticket = {
    ticket_type: 'player_report',
    escalation_index: 0,
    ticket_number: 225
  };

  assert.deepEqual(
    getCurrentHandlerRoleIds(ticket),
    [TICKET_CONFIG.roles.trialAdmin, TICKET_CONFIG.roles.admin]
  );
  assert.deepEqual(
    getNextEscalationRoleIds(ticket),
    [TICKET_CONFIG.roles.seniorAdmin]
  );

  ticket.escalation_index = 1;
  assert.deepEqual(
    getCurrentHandlerRoleIds(ticket),
    [TICKET_CONFIG.roles.seniorAdmin]
  );
  assert.deepEqual(
    getNextEscalationRoleIds(ticket),
    [TICKET_CONFIG.roles.owner]
  );

  ticket.escalation_index = 2;
  assert.deepEqual(
    getCurrentHandlerRoleIds(ticket),
    [TICKET_CONFIG.roles.owner]
  );
  assert.deepEqual(getNextEscalationRoleIds(ticket), []);
});

test('Official Unit escalates to Discord Admin and Owner together', () => {
  const ticket = {
    ticket_type: 'official_unit',
    escalation_index: 0,
    ticket_number: 226
  };

  assert.deepEqual(
    getCurrentHandlerRoleIds(ticket),
    [TICKET_CONFIG.roles.discordModerator]
  );
  assert.deepEqual(
    getNextEscalationRoleIds(ticket),
    [TICKET_CONFIG.roles.discordAdmin, TICKET_CONFIG.roles.owner]
  );
});

test('Dedicated Pilot has no escalation path', () => {
  const ticket = {
    ticket_type: 'dedicated_pilot',
    escalation_index: 0,
    ticket_number: 227
  };

  assert.deepEqual(
    getCurrentHandlerRoleIds(ticket),
    [TICKET_CONFIG.roles.discordModerator]
  );
  assert.deepEqual(getNextEscalationRoleIds(ticket), []);

  const row = buildTicketButtons(ticket).toJSON();
  assert.equal(
    row.components.some(component => component.custom_id === 'tlc_ticket_escalate:227'),
    false
  );
});

test('ticket controls retain Claim and both Close actions', () => {
  const ticket = {
    ticket_type: 'player_report',
    escalation_index: 0,
    ticket_number: 228
  };

  const ids = buildTicketButtons(ticket)
    .toJSON()
    .components
    .map(component => component.custom_id);

  assert.deepEqual(ids, [
    'tlc_ticket_claim:228',
    'tlc_ticket_escalate:228',
    'tlc_ticket_close:228',
    'tlc_ticket_close_reason:228'
  ]);
});

test('ticket button parser accepts valid controls and rejects unrelated IDs', () => {
  assert.deepEqual(parseTicketButton('tlc_ticket_claim:225'), {
    action: 'claim',
    ticketNumber: 225
  });
  assert.deepEqual(parseTicketButton('tlc_ticket_close_reason:999'), {
    action: 'close_reason',
    ticketNumber: 999
  });
  assert.deepEqual(parseTicketButton('tlc_ticket_approve_trainee:227'), {
    action: 'approve_trainee',
    ticketNumber: 227
  });
  assert.equal(parseTicketButton('show_mods'), null);
  assert.equal(parseTicketButton('tlc_ticket_claim:not-a-number'), null);
});

test('close override roles are exactly Discord Admin, Owner, and Senior Admin', () => {
  assert.deepEqual([...TICKET_CLOSE_OVERRIDE_ROLE_IDS], [
    TICKET_CONFIG.roles.discordAdmin,
    TICKET_CONFIG.roles.owner,
    TICKET_CONFIG.roles.seniorAdmin
  ]);
});

test('all ticket types have unique labels and valid routing arrays', () => {
  const types = Object.values(TICKET_TYPES);
  assert.equal(new Set(types.map(type => type.label)).size, types.length);

  for (const type of types) {
    assert.ok(type.label.length > 0);
    assert.ok(type.description.length > 0);
    assert.ok(type.instructions.length > 0);
    assert.ok(Array.isArray(type.initialRoleIds));
    assert.ok(type.initialRoleIds.length > 0);
    assert.ok(Array.isArray(type.escalationLevels));
  }
});

test('pilot and drone applications notify priority staff immediately without escalation', () => {
  for (const key of ['dedicated_pilot', 'drone_operator']) {
    const type = TICKET_TYPES[key];

    assert.deepEqual(type.openingPingRoleIds, [
      TICKET_CONFIG.roles.owner,
      TICKET_CONFIG.roles.seniorAdmin,
      TICKET_CONFIG.roles.discordAdmin
    ]);
    assert.deepEqual(type.escalationLevels, []);
  }
});

test('pilot and drone tickets expose trainee approval controls', () => {
  const pilot = {
    ticket_type: 'dedicated_pilot',
    escalation_index: 0,
    ticket_number: 301,
    trainee_approved_at: null
  };
  const drone = {
    ticket_type: 'drone_operator',
    escalation_index: 0,
    ticket_number: 302,
    trainee_approved_at: null
  };

  for (const ticket of [pilot, drone]) {
    const row = buildTicketButtons(ticket).toJSON();
    const approvalButton = row.components.find(
      component => component.custom_id === `tlc_ticket_approve_trainee:${ticket.ticket_number}`
    );

    assert.ok(approvalButton);
    assert.equal(approvalButton.label, 'Approve as Trainee');
    assert.equal(approvalButton.disabled, false);
  }
});

test('approved trainee button becomes disabled', () => {
  const row = buildTicketButtons({
    ticket_type: 'dedicated_pilot',
    escalation_index: 0,
    ticket_number: 303,
    trainee_approved_at: new Date().toISOString()
  }).toJSON();

  const approvalButton = row.components.find(
    component => component.custom_id === 'tlc_ticket_approve_trainee:303'
  );

  assert.equal(approvalButton.label, 'Trainee Approved');
  assert.equal(approvalButton.disabled, true);
});

test('trainee approval configuration uses the requested role IDs and senior approvers', () => {
  assert.equal(TICKET_CONFIG.roles.traineePilot, '1546935180713926766');
  assert.equal(TICKET_CONFIG.roles.traineeDroneOperator, '1548325333327945758');

  assert.equal(
    TICKET_TYPES.dedicated_pilot.traineeApproval.roleId,
    TICKET_CONFIG.roles.traineePilot
  );
  assert.equal(
    TICKET_TYPES.drone_operator.traineeApproval.roleId,
    TICKET_CONFIG.roles.traineeDroneOperator
  );

  assert.deepEqual([...TICKET_TRAINEE_APPROVER_ROLE_IDS], [
    TICKET_CONFIG.roles.owner,
    TICKET_CONFIG.roles.seniorAdmin,
    TICKET_CONFIG.roles.discordAdmin
  ]);

  const member = {
    roles: {
      cache: new Map([[TICKET_CONFIG.roles.discordAdmin, { id: TICKET_CONFIG.roles.discordAdmin }]])
    }
  };
  assert.equal(canApproveTrainee(member), true);
});
