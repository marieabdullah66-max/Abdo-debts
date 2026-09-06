from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from ..core import current_profile, require_permission, sb

router=APIRouter(prefix='/api/report-drafts',tags=['report-drafts'])

@router.get('')
async def list_drafts(profile:dict[str,Any]=Depends(current_profile)):
    require_permission(profile,'view_dashboard')
    return await sb('GET','/rest/v1/report_drafts',service=True,params={'select':'*','profile_id':f"eq.{profile['id']}",'order':'updated_at.desc'})

@router.post('')
async def create_or_update_draft(payload:dict[str,Any],profile:dict[str,Any]=Depends(current_profile)):
    require_permission(profile,'view_dashboard')
    row={**payload,'profile_id':profile['id']}
    if row.get('id'):
        rid=row.pop('id')
        return (await sb('PATCH',f'/rest/v1/report_drafts?id=eq.{rid}',service=True,json=row))[0]
    return (await sb('POST','/rest/v1/report_drafts',service=True,json=row))[0]

@router.delete('/{draft_id}')
async def delete_draft(draft_id:str,profile:dict[str,Any]=Depends(current_profile)):
    require_permission(profile,'view_dashboard')
    await sb('DELETE',f'/rest/v1/report_drafts?id=eq.{draft_id}&profile_id=eq.{profile["id"]}',service=True)
    return {'ok':True}
