import sys
import os
import types

# Mock pytest module so test imports succeed
pytest_mock = types.ModuleType("pytest")
sys.modules["pytest"] = pytest_mock

# Set python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
from tests.test_ranking import test_rank_locators_anchored_xpath
from tests.test_profiles import test_serialize_doc
from tests.test_executor import test_interpolate_variables, test_resolve_input_bindings, test_interpolate_variables_dynamic_tokens, test_interpolate_variables_date_math, test_resolve_request, test_resolve_request_with_interceptor_hmac_header, test_extract_jwt_expiry_fallback, test_get_valid_auth_token_caching
from tests.test_generator import test_build_pom_method_code_with_url, test_record_interaction
from tests.test_workspace import test_sanitize_filename, test_reset_workspace_file, test_migrate_legacy_workspace_layout
from tests.test_admin import test_serialize_user, test_serialize_collection
from tests.test_flows import test_serialize_flow_doc
from tests.test_auth import test_expired_token_reports_expiry_not_bad_signature, test_refresh_token_rotates_and_rejects_replay, test_refresh_token_rejected_when_expired_or_user_disabled, test_revoke_is_idempotent
from tests.test_user_guides import test_serialize_guide_hierarchy_fields, test_normalize_slug, test_compute_depth_and_height, test_is_descendant_cycle_detection, test_move_depth_rule
from tests.test_local_ai import test_validate_assistant_response_shapes, test_normalize_messages_merges_roles
from tests.test_flow_runner import (
    test_linear_chain_pipes_outputs,
    test_fanout_runs_branches_concurrently,
    test_merge_waits_for_all_branches_and_sees_both_outputs,
    test_failure_skips_only_descendants,
    test_shared_merge_skipped_exactly_once,
    test_looper_iterates_and_publishes_results,
    test_looper_stops_on_first_failing_iteration,
    test_verifier_retries_until_comparisons_pass,
    test_verifier_exhausts_attempts_and_fails,
    test_unresolved_reference_fails_node,
    test_executor_exception_becomes_failed_record,
    test_cycle_rejected,
    test_timeout_cancels_run,
    test_delay_node_waits_and_succeeds,
    test_auth_override_pref_applied,
    test_walk_path_and_references,
    test_interpolate_studio_tokens_leaves_backend_tokens,
    test_evaluate_comparison_operators,
    test_build_run_csv_orders_and_escapes,
    test_condense_summary_digest_and_truncation,
)
from tests.test_flow_runner_v2 import (
    test_golden_fixtures,
    test_json_path_normalization,
    test_compare_values_operators,
    test_parse_handle_and_ports,
    test_parse_static_input_types,
    test_validate_flow_v2_rules,
    test_invalid_flow_aborts_before_running,
    test_done_after_barrier_waits_for_whole_stream,
    test_cancellation_mid_stream,
    test_partial_failure_reports_item_counts,
)
from tests.test_mcp_tools import run_mcp_tool_tests
from tests.test_flow_runs import test_flow_runs_store_roundtrip, test_flow_runs_routes

def run():
    print("Running tests...")
    
    try:
        test_rank_locators_anchored_xpath()
        print("✓ test_rank_locators_anchored_xpath passed")
        
        test_serialize_doc()
        print("✓ test_serialize_doc passed")
        
        test_interpolate_variables()
        print("✓ test_interpolate_variables passed")

        test_resolve_input_bindings()
        print("✓ test_resolve_input_bindings passed")

        test_interpolate_variables_dynamic_tokens()
        print("✓ test_interpolate_variables_dynamic_tokens passed")

        test_interpolate_variables_date_math()
        print("✓ test_interpolate_variables_date_math passed")

        asyncio.run(test_resolve_request())
        print("✓ test_resolve_request passed")

        asyncio.run(test_resolve_request_with_interceptor_hmac_header())
        print("✓ test_resolve_request_with_interceptor_hmac_header passed")

        test_extract_jwt_expiry_fallback()
        print("✓ test_extract_jwt_expiry_fallback passed")
        
        asyncio.run(test_get_valid_auth_token_caching())
        print("✓ test_get_valid_auth_token_caching passed")
        
        test_sanitize_filename()
        print("✓ test_sanitize_filename passed")

        asyncio.run(test_reset_workspace_file())
        print("✓ test_reset_workspace_file passed")

        asyncio.run(test_migrate_legacy_workspace_layout())
        print("✓ test_migrate_legacy_workspace_layout passed")

        test_build_pom_method_code_with_url()
        print("✓ test_build_pom_method_code_with_url passed")
        
        asyncio.run(test_record_interaction())
        print("✓ test_record_interaction passed")
        
        test_serialize_user()
        print("✓ test_serialize_user passed")
        
        test_serialize_collection()
        print("✓ test_serialize_collection passed")

        test_serialize_flow_doc()
        print("✓ test_serialize_flow_doc passed")

        asyncio.run(test_expired_token_reports_expiry_not_bad_signature())
        print("✓ test_expired_token_reports_expiry_not_bad_signature passed")

        asyncio.run(test_refresh_token_rotates_and_rejects_replay())
        print("✓ test_refresh_token_rotates_and_rejects_replay passed")

        asyncio.run(test_refresh_token_rejected_when_expired_or_user_disabled())
        print("✓ test_refresh_token_rejected_when_expired_or_user_disabled passed")

        asyncio.run(test_revoke_is_idempotent())
        print("✓ test_revoke_is_idempotent passed")

        test_serialize_guide_hierarchy_fields()
        print("✓ test_serialize_guide_hierarchy_fields passed")

        test_normalize_slug()
        print("✓ test_normalize_slug passed")

        test_compute_depth_and_height()
        print("✓ test_compute_depth_and_height passed")

        test_is_descendant_cycle_detection()
        print("✓ test_is_descendant_cycle_detection passed")

        test_move_depth_rule()
        print("✓ test_move_depth_rule passed")

        test_validate_assistant_response_shapes()
        print("✓ test_validate_assistant_response_shapes passed")

        test_normalize_messages_merges_roles()
        print("✓ test_normalize_messages_merges_roles passed")

        asyncio.run(test_linear_chain_pipes_outputs())
        print("✓ test_linear_chain_pipes_outputs passed")

        asyncio.run(test_fanout_runs_branches_concurrently())
        print("✓ test_fanout_runs_branches_concurrently passed")

        asyncio.run(test_merge_waits_for_all_branches_and_sees_both_outputs())
        print("✓ test_merge_waits_for_all_branches_and_sees_both_outputs passed")

        asyncio.run(test_failure_skips_only_descendants())
        print("✓ test_failure_skips_only_descendants passed")

        asyncio.run(test_shared_merge_skipped_exactly_once())
        print("✓ test_shared_merge_skipped_exactly_once passed")

        asyncio.run(test_looper_iterates_and_publishes_results())
        print("✓ test_looper_iterates_and_publishes_results passed")

        asyncio.run(test_looper_stops_on_first_failing_iteration())
        print("✓ test_looper_stops_on_first_failing_iteration passed")

        asyncio.run(test_verifier_retries_until_comparisons_pass())
        print("✓ test_verifier_retries_until_comparisons_pass passed")

        asyncio.run(test_verifier_exhausts_attempts_and_fails())
        print("✓ test_verifier_exhausts_attempts_and_fails passed")

        asyncio.run(test_unresolved_reference_fails_node())
        print("✓ test_unresolved_reference_fails_node passed")

        asyncio.run(test_executor_exception_becomes_failed_record())
        print("✓ test_executor_exception_becomes_failed_record passed")

        test_cycle_rejected()
        print("✓ test_cycle_rejected passed")

        asyncio.run(test_timeout_cancels_run())
        print("✓ test_timeout_cancels_run passed")

        asyncio.run(test_delay_node_waits_and_succeeds())
        print("✓ test_delay_node_waits_and_succeeds passed")

        asyncio.run(test_auth_override_pref_applied())
        print("✓ test_auth_override_pref_applied passed")

        test_walk_path_and_references()
        print("✓ test_walk_path_and_references passed")

        test_interpolate_studio_tokens_leaves_backend_tokens()
        print("✓ test_interpolate_studio_tokens_leaves_backend_tokens passed")

        test_evaluate_comparison_operators()
        print("✓ test_evaluate_comparison_operators passed")

        test_build_run_csv_orders_and_escapes()
        print("✓ test_build_run_csv_orders_and_escapes passed")

        test_condense_summary_digest_and_truncation()
        print("✓ test_condense_summary_digest_and_truncation passed")

        test_json_path_normalization()
        print("✓ test_json_path_normalization passed")

        test_compare_values_operators()
        print("✓ test_compare_values_operators passed")

        test_parse_handle_and_ports()
        print("✓ test_parse_handle_and_ports passed")

        test_parse_static_input_types()
        print("✓ test_parse_static_input_types passed")

        test_validate_flow_v2_rules()
        print("✓ test_validate_flow_v2_rules passed")

        asyncio.run(test_golden_fixtures())
        print("✓ test_golden_fixtures passed")

        asyncio.run(test_invalid_flow_aborts_before_running())
        print("✓ test_invalid_flow_aborts_before_running passed")

        asyncio.run(test_done_after_barrier_waits_for_whole_stream())
        print("✓ test_done_after_barrier_waits_for_whole_stream passed")

        asyncio.run(test_cancellation_mid_stream())
        print("✓ test_cancellation_mid_stream passed")

        asyncio.run(test_partial_failure_reports_item_counts())
        print("✓ test_partial_failure_reports_item_counts passed")

        run_mcp_tool_tests()

        test_flow_runs_store_roundtrip()
        print("✓ test_flow_runs_store_roundtrip passed")

        asyncio.run(test_flow_runs_routes())
        print("✓ test_flow_runs_routes passed")

        print("\nAll tests passed successfully!")
    except AssertionError as e:
        print(f"\nAssertion Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run()
