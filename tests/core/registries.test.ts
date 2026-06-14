import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry, KeybindingRegistry, ServiceRegistry } from '../../src/core/registries.ts';

test('command run invokes the registered handler and returns its result', async () => {
  const reg = new CommandRegistry();
  reg.register('math.add', (args: { a: number; b: number }) => args.a + args.b);
  assert.equal(await reg.run('math.add', { a: 2, b: 3 }), 5);
});

test('running an unknown command throws', async () => {
  const reg = new CommandRegistry();
  await assert.rejects(() => reg.run('nope', undefined), /unknown command: nope/);
});

test('command ids list every registered id', () => {
  const reg = new CommandRegistry();
  reg.register('a', () => {});
  reg.register('b', () => {});
  assert.deepEqual(reg.ids().sort(), ['a', 'b']);
});

test('keybindings bind and resolve a key spec to a command id', () => {
  const keys = new KeybindingRegistry();
  keys.bind('ctrl+s', 'file.save');
  assert.equal(keys.resolve('ctrl+s'), 'file.save');
  assert.equal(keys.resolve('ctrl+x'), undefined);
});

test('services register and get a shared implementation', () => {
  const services = new ServiceRegistry();
  services.register('greeter', { hi: () => 'hello' });
  assert.equal(services.get<{ hi: () => string }>('greeter').hi(), 'hello');
});

test('getting an unknown service throws', () => {
  const services = new ServiceRegistry();
  assert.throws(() => services.get('nope'), /unknown service: nope/);
});
