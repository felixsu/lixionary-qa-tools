import pytest
import asyncio
from services.auth_sandbox import run_unsafe_auth_script, run_unsafe_response_parser

@pytest.mark.asyncio
async def test_run_unsafe_auth_script_success():
    script = """
    const secret = env.API_SECRET;
    return 'Token_' + secret;
    """
    env = {"API_SECRET": "my_super_secret"}
    result = await run_unsafe_auth_script(script, env)
    assert result == "Token_my_super_secret"

@pytest.mark.asyncio
async def test_run_unsafe_auth_script_syntax_error():
    script = """
    const x = ; // syntax error
    """
    result = await run_unsafe_auth_script(script, {})
    assert "ERROR:" in result

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_vars_alias():
    # Legacy scripts using vars.set still work and land in env_writes
    body = '{"data": {"token": "abcd-999"}}'
    headers = {"Content-Type": "application/json"}
    script = "vars.set('auth_token', response.body.data.token);"

    outputs, env_writes = await run_unsafe_response_parser(body, headers, script)
    assert outputs == {}
    assert env_writes == {"auth_token": "abcd-999"}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_env_set():
    body = '{"data": {"token": "abcd-999"}}'
    headers = {"Content-Type": "application/json"}
    script = "env.set('auth_token', response.body.data.token);"

    outputs, env_writes = await run_unsafe_response_parser(body, headers, script)
    assert outputs == {}
    assert env_writes == {"auth_token": "abcd-999"}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_output_object():
    body = '{"data": {"order_id": "ORD-7"}}'
    headers = {}
    script = "output.order_id = response.body.data.order_id;"

    outputs, env_writes = await run_unsafe_response_parser(body, headers, script)
    assert outputs == {"order_id": "ORD-7"}
    assert env_writes == {}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_output_and_env():
    body = '{"data": {"order_id": "ORD-7", "token": "t-1"}}'
    headers = {}
    script = """
    output.order_id = response.body.data.order_id;
    env.set('last_token', response.body.data.token);
    """

    outputs, env_writes = await run_unsafe_response_parser(body, headers, script)
    assert outputs == {"order_id": "ORD-7"}
    assert env_writes == {"last_token": "t-1"}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_empty_script():
    outputs, env_writes = await run_unsafe_response_parser('{"a": 1}', {}, "const nothing = 1;")
    assert outputs == {}
    assert env_writes == {}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_numeric_value():
    body = '{"data": [{"id": 5272122, "name": "Dhiba SG 55"}]}'
    headers = {"Content-Type": "application/json"}
    script = "if(response && response.body && response.body.data && response.body.data.length > 0) { output.shipper_id = response.body.data[0].id; }"

    outputs, _ = await run_unsafe_response_parser(body, headers, script)
    assert outputs == {"shipper_id": 5272122}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_boolean_value():
    body = '{"data": {"active": true}}'
    headers = {}
    script = "output.is_active = response.body.data.active; env.set('is_active', response.body.data.active);"

    outputs, env_writes = await run_unsafe_response_parser(body, headers, script)
    assert outputs == {"is_active": True}
    assert env_writes == {"is_active": True}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_object_value_stringified():
    # env.set stringifies objects for the quickjs->Python bridge; output keeps structure
    body = '{"data": {"user": {"id": 1, "name": "a"}}}'
    headers = {}
    script = "env.set('user', response.body.data.user); output.user = response.body.data.user;"

    outputs, env_writes = await run_unsafe_response_parser(body, headers, script)
    assert env_writes == {"user": '{"id":1,"name":"a"}'}
    assert outputs == {"user": {"id": 1, "name": "a"}}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_null_value():
    body = '{"data": {"missing": null}}'
    headers = {}
    script = "env.set('missing', response.body.data.missing);"

    _, env_writes = await run_unsafe_response_parser(body, headers, script)
    assert env_writes == {"missing": ""}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_script_error_raises():
    body = '{"data": {}}'
    headers = {}
    script = "output.x = response.nope.deep.path;"

    with pytest.raises(RuntimeError):
        await run_unsafe_response_parser(body, headers, script)
