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
async def test_run_unsafe_response_parser_success():
    body = '{"data": {"token": "abcd-999"}}'
    headers = {"Content-Type": "application/json"}
    script = "vars.set('auth_token', response.body.data.token);"

    extracted = await run_unsafe_response_parser(body, headers, script)
    assert extracted == {"auth_token": "abcd-999"}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_numeric_value():
    body = '{"data": [{"id": 5272122, "name": "Dhiba SG 55"}]}'
    headers = {"Content-Type": "application/json"}
    script = "if(response && response.body && response.body.data && response.body.data.length > 0) { vars.set('shipper_id', response.body.data[0].id); }"

    extracted = await run_unsafe_response_parser(body, headers, script)
    assert extracted == {"shipper_id": 5272122}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_boolean_value():
    body = '{"data": {"active": true}}'
    headers = {}
    script = "vars.set('is_active', response.body.data.active);"

    extracted = await run_unsafe_response_parser(body, headers, script)
    assert extracted == {"is_active": True}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_object_value_stringified():
    body = '{"data": {"user": {"id": 1, "name": "a"}}}'
    headers = {}
    script = "vars.set('user', response.body.data.user);"

    extracted = await run_unsafe_response_parser(body, headers, script)
    assert extracted == {"user": '{"id":1,"name":"a"}'}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_null_value():
    body = '{"data": {"missing": null}}'
    headers = {}
    script = "vars.set('missing', response.body.data.missing);"

    extracted = await run_unsafe_response_parser(body, headers, script)
    assert extracted == {"missing": ""}

@pytest.mark.asyncio
async def test_run_unsafe_response_parser_script_error_raises():
    body = '{"data": {}}'
    headers = {}
    script = "vars.set('x', response.nope.deep.path);"

    with pytest.raises(RuntimeError):
        await run_unsafe_response_parser(body, headers, script)
