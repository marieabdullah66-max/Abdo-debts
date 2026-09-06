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
    draft_id=row.get('id')
    if draft_id:
        row.pop('id',None)
        result=await sb('PATCH',f'/rest/v1/report_drafts?id=eq.{draft_id}',service=True,json=row)
        return result[0] if result else {'id':draft_id}
    row.pop('id',None)
    result=await sb('POST','/rest/v1/report_drafts',service=True,json=row)
    return result[0] if result else row

@router.delete('/{draft_id}')
async def delete_draft(draft_id:str,profile:dict[str,Any]=Depends(current_profile)):
    require_permission(profile,'view_dashboard')
    await sb('DELETE',f'/rest/v1/report_drafts?id=eq.{draft_id}&profile_id=eq.{profile["id"]}',service=True)
    return {'ok':True}
